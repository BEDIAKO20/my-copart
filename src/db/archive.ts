/**
 * Copies everything out of the primary Neon database into the ARCHIVE
 * database, verifies the copy landed intact, then permanently clears the
 * primary database — products, images, bids, specs, source, category, and
 * subcategory.
 *
 * Run this BEFORE `npm start` whenever you want the next crawl to start from
 * an empty database without losing what's already there.
 *
 *   npm run db:archive                  # dry run — shows what would happen
 *   npm run db:archive -- --confirm     # actually copies, then clears
 *
 * Nothing is ever cleared unless the copy is verified first. If anything
 * fails partway through, the primary database is left untouched.
 */
import { getPrisma, disconnectPrisma } from "./prisma.js";
import { getArchivePrisma, disconnectArchivePrisma, isArchiveDbConfigured } from "./archive-prisma.js";
import { assertDatabaseReady } from "./preflight.js";
import type { Prisma, PrismaClient } from "../generated/prisma/client.js";

const CONFIRMED = process.argv.includes("--confirm");
const BATCH_SIZE = 500;

type Counts = Record<
    "source" | "category" | "subcategory" | "products" | "productImages" | "currentBid" | "spec",
    number
>;

async function countAll(prisma: PrismaClient): Promise<Counts> {
    return {
        source: await prisma.source.count(),
        category: await prisma.category.count(),
        subcategory: await prisma.subcategory.count(),
        products: await prisma.product.count(),
        productImages: await prisma.productImage.count(),
        currentBid: await prisma.currentBid.count(),
        spec: await prisma.spec.count(),
    };
}

function* chunks<T>(items: T[], size: number): Generator<T[]> {
    for (let i = 0; i < items.length; i += size) yield items.slice(i, i + size);
}

/** Copies every table, parents before children, so no FK write ever fails. */
async function copyEverything(primary: PrismaClient, archive: PrismaClient): Promise<void> {
    // source, category — no dependencies. subcategory needs category.
    const sources = await primary.source.findMany();
    if (sources.length) await archive.source.createMany({ data: sources, skipDuplicates: true });

    const categories = await primary.category.findMany();
    if (categories.length) await archive.category.createMany({ data: categories, skipDuplicates: true });

    const subcategories = await primary.subcategory.findMany();
    if (subcategories.length) {
        await archive.subcategory.createMany({ data: subcategories, skipDuplicates: true });
    }

    // products — needs source + category + subcategory to already exist.
    // `raw` reads back as JsonValue (which permits `null` anywhere, including
    // nested), but createMany's input type is stricter — the cast is safe
    // since this is exactly the JSON Postgres already validated on the way in.
    const products = (await primary.product.findMany()).map((p) => ({
        ...p,
        raw: (p.raw ?? undefined) as Prisma.InputJsonValue | undefined,
    }));
    for (const batch of chunks(products, BATCH_SIZE)) {
        await archive.product.createMany({ data: batch, skipDuplicates: true });
    }

    // products' own children.
    for (const batch of chunks(await primary.productImage.findMany(), BATCH_SIZE)) {
        await archive.productImage.createMany({ data: batch, skipDuplicates: true });
    }
    for (const batch of chunks(await primary.currentBid.findMany(), BATCH_SIZE)) {
        await archive.currentBid.createMany({ data: batch, skipDuplicates: true });
    }
    for (const batch of chunks(await primary.spec.findMany(), BATCH_SIZE)) {
        await archive.spec.createMany({ data: batch, skipDuplicates: true });
    }
}

/** Confirms the archive DB actually holds at least as many rows as the primary had, per table. */
async function verifyCopy(archive: PrismaClient, expected: Counts): Promise<void> {
    const actual = await countAll(archive);
    const short = (Object.keys(expected) as (keyof Counts)[]).filter((k) => actual[k] < expected[k]);
    if (short.length > 0) {
        throw new Error(
            "Copy verification FAILED — refusing to clear the primary database.\n" +
                short.map((k) => `  ${k}: expected at least ${expected[k]}, archive has ${actual[k]}`).join("\n")
        );
    }
}

/** One statement, children before parents. */
async function clearPrimary(primary: PrismaClient): Promise<void> {
    await primary.$executeRaw`
        TRUNCATE TABLE
            product_images, current_bid, spec, products,
            subcategory, category, source
        RESTART IDENTITY CASCADE`;
}

async function main() {
    if (!isArchiveDbConfigured()) {
        console.error(
            "ARCHIVE_DATABASE_URL is not set. Add it to .env — see .env.example — " +
                "pointing at the second database you want old data moved into, then run\n" +
                "`npm run db:archive:setup` once to give it the same schema as the primary."
        );
        process.exitCode = 1;
        return;
    }

    const primary = getPrisma();
    const archive = getArchivePrisma();

    console.log("Checking both databases...");
    const primaryInfo = await assertDatabaseReady({
        prisma: primary,
        connectionUrl: process.env.DATABASE_URL,
        label: "primary",
    });
    console.log(`  primary: ${primaryInfo.database} on ${primaryInfo.host}`);

    const archiveInfo = await assertDatabaseReady({
        prisma: archive,
        connectionUrl: process.env.ARCHIVE_DATABASE_URL,
        label: "archive",
        setupHint: "npm run db:archive:setup   (applies migrations to the archive database)",
    });
    console.log(`  archive: ${archiveInfo.database} on ${archiveInfo.host}`);

    const counts = await countAll(primary);
    const total = Object.values(counts).reduce((a, b) => a + b, 0);

    console.log("\n─── what's currently in the primary database ────────────────");
    for (const [table, count] of Object.entries(counts)) {
        console.log(`  ${table.padEnd(14)} ${count}`);
    }

    if (total === 0) {
        console.log("\nPrimary database is already empty — nothing to archive.");
        return;
    }

    if (!CONFIRMED) {
        console.log(
            `\nDRY RUN — this would copy all ${total} row(s) above into the archive database,\n` +
                "verify the copy, then PERMANENTLY CLEAR the primary database. Nothing has\n" +
                "been touched.\n\n" +
                "Re-run with --confirm to actually do this:\n" +
                "  npm run db:archive -- --confirm"
        );
        return;
    }

    console.log("\nCopying into the archive database...");
    await copyEverything(primary, archive);

    console.log("Verifying the copy...");
    await verifyCopy(archive, counts);

    console.log("Clearing the primary database...");
    await clearPrimary(primary);

    console.log(
        `\nDone — ${total} row(s) moved to the archive database and the primary database is now empty.\n` +
            "Run `npm start` whenever you're ready to crawl again."
    );
}

main()
    .catch((err) => {
        console.error(`\nArchive failed: ${(err as Error).message}`);
        console.error("The primary database was NOT modified.");
        process.exitCode = 1;
    })
    .finally(async () => {
        await disconnectPrisma();
        await disconnectArchivePrisma();
    });
