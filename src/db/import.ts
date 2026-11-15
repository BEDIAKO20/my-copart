/**
 * Imports scraped JSON files into Neon through the normalization layer.
 *
 *   npm run db:import                          # copart, storage/datasets/default
 *   npm run db:import -- iaai                  # a different site's normalizer
 *   npm run db:import -- iaai storage/datasets/iaai
 *
 * Re-running is safe: each listing upserts on (source_id, external_id).
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { disconnectPrisma } from "./prisma.js";
import { saveScraped } from "./listings.js";
import { getNormalizer } from "../normalize/index.js";

const [slugArg, dirArg] = process.argv.slice(2);

const SOURCE_SLUG = slugArg ?? "copart";
const DATASET_DIR =
    dirArg ?? path.join(process.env.CRAWLEE_STORAGE_DIR ?? "storage", "datasets", "default");

async function loadRecords(dir: string): Promise<unknown[]> {
    const files = (await readdir(dir)).filter((f) => f.endsWith(".json")).sort();

    const records: unknown[] = [];
    for (const file of files) {
        const raw = await readFile(path.join(dir, file), "utf8");
        let parsed: unknown;
        try {
            parsed = JSON.parse(raw);
        } catch {
            console.warn(`  skipped ${file}: not valid JSON`);
            continue;
        }

        // Crawlee writes one record per file, but exports can hold an array.
        records.push(...(Array.isArray(parsed) ? parsed : [parsed]));
    }
    return records;
}

async function main() {
    // Fails fast with the list of known sources if the slug is wrong.
    const normalizer = getNormalizer(SOURCE_SLUG);

    console.log(`Source:  ${normalizer.source.name} (${SOURCE_SLUG})`);
    console.log(`Reading: ${DATASET_DIR}`);

    const records = await loadRecords(DATASET_DIR);
    if (records.length === 0) {
        console.log("No records found — nothing to import.");
        return;
    }
    console.log(`Importing ${records.length} record(s)...`);

    let inserted = 0;
    let updated = 0;
    let skipped = 0;
    let images = 0;
    const failures: string[] = [];

    for (const [index, record] of records.entries()) {
        try {
            const result = await saveScraped(SOURCE_SLUG, record);
            if (!result) {
                skipped++;
                continue;
            }
            if (result.inserted) inserted++;
            else updated++;
            images += result.imageCount;
        } catch (err) {
            failures.push(`record #${index}: ${(err as Error).message}`);
        }
    }

    console.log(
        `Done — ${inserted} inserted, ${updated} updated, ${skipped} skipped ` +
            `(not normalizable), ${images} image row(s) written.`
    );

    if (failures.length > 0) {
        console.error(`\n${failures.length} record(s) failed:`);
        for (const f of failures.slice(0, 20)) console.error(`  ${f}`);
        process.exitCode = 1;
    }
}

main()
    .catch((err) => {
        console.error(`Import failed: ${(err as Error).message}`);
        process.exitCode = 1;
    })
    .finally(disconnectPrisma);
