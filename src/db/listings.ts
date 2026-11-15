import { getPrisma } from "./prisma.js";
import { resolveCategory } from "./categories.js";
import type { Prisma, PrismaClient } from "../generated/prisma/client.js";
import { normalize } from "../normalize/index.js";
import type { NormalizedListing, NormalizedSource } from "../normalize/types.js";

/**
 * Writes normalized listings into the products-centric structure:
 *
 *   products ⭐
 *    ├── category
 *    ├── subcategory
 *    ├── source
 *    ├── product_images
 *    ├── current_bid
 *    └── spec
 *
 * Completely site-agnostic: it only ever sees a `NormalizedListing`, so every
 * website — vehicles, parts, food, electronics — reaches the SAME `products`
 * table through the same code path. There is no per-site branch anywhere below
 * this line.
 *
 * Deduplication is on (source_id, external_id) — an existing listing is
 * UPDATED in place, never inserted a second time.
 */

/** Drops null/undefined entries so a blank re-scrape can't overwrite good data. */
function compact<T extends object>(obj: T): Partial<T> {
    return Object.fromEntries(
        Object.entries(obj).filter(([, v]) => v !== null && v !== undefined)
    ) as Partial<T>;
}

function toJsonInput(raw: unknown): Prisma.InputJsonValue | undefined {
    if (raw === null || raw === undefined) return undefined;
    return raw as Prisma.InputJsonValue;
}

// ─── source ───────────────────────────────────────────────────────────────────

const sourceIdCache = new Map<string, string>();

/** Get-or-create the `source` row for a site, cached per process. */
export async function ensureSource(source: NormalizedSource): Promise<string> {
    const cached = sourceIdCache.get(source.slug);
    if (cached !== undefined) return cached;

    const prisma: PrismaClient = getPrisma();

    const existing = await prisma.source.findUnique({
        where: { slug: source.slug },
        select: { id: true, description: true },
    });
    if (existing) {
        // Fill in a description added to the normalizer after the row existed.
        if (!existing.description && source.description) {
            await prisma.source.update({
                where: { id: existing.id },
                data: { description: source.description },
            });
        }
        sourceIdCache.set(source.slug, existing.id);
        return existing.id;
    }

    try {
        const created = await prisma.source.create({
            data: {
                slug: source.slug,
                name: source.name,
                description: source.description ?? null,
                url: source.url ?? null,
                ...(source.type ? { type: source.type } : {}),
            },
            select: { id: true },
        });
        sourceIdCache.set(source.slug, created.id);
        return created.id;
    } catch (err) {
        // Another worker created it first — re-read instead of failing.
        if ((err as { code?: string }).code !== "P2002") throw err;
        const raced = await prisma.source.findUniqueOrThrow({
            where: { slug: source.slug },
            select: { id: true },
        });
        sourceIdCache.set(source.slug, raced.id);
        return raced.id;
    }
}

// ─── listings ─────────────────────────────────────────────────────────────────

export interface UpsertListingResult {
    /** UUID of the row in the main `products` table. */
    productId: string;
    sourceId: string;
    categoryId: string | null;
    categoryName: string | null;
    subcategoryId: string | null;
    /** False when an existing listing was updated rather than created. */
    inserted: boolean;
    imageCount: number;
    specCount: number;
    /** False when this scrape had no auction data to write. */
    bidWritten: boolean;
}

export interface UpsertListingOptions {
    /** Override timestamps — used by the legacy backfill to preserve history. */
    createdAt?: Date;
    lastScrapedAt?: Date;
}

// Neon round trips add up; the 5s interactive-transaction default is too tight.
const TX_OPTIONS = { maxWait: 15_000, timeout: 60_000 };

async function upsertListingInTx(
    tx: Prisma.TransactionClient,
    sourceId: string,
    categoryIds: { categoryId: string | null; categoryName: string | null; subcategoryId: string | null },
    listing: NormalizedListing,
    options: UpsertListingOptions
): Promise<UpsertListingResult> {
    const { product, currentBid, images, specs } = listing;
    const lastScrapedAt = options.lastScrapedAt ?? new Date();

    const existing = await tx.product.findUnique({
        where: { sourceId_externalId: { sourceId, externalId: listing.externalId } },
        select: { id: true },
    });

    // ── products: the main table ─────────────────────────────────────────────
    // Null category ids are compacted away too, so a scrape that lost its
    // category can't unlink a product that had one.
    const fields = { ...compact(product), ...compact(categoryIds) };

    let productId: string;
    if (existing) {
        const updated = await tx.product.update({
            where: { id: existing.id },
            data: { ...fields, raw: toJsonInput(listing.raw), lastScrapedAt },
            select: { id: true },
        });
        productId = updated.id;
    } else {
        const created = await tx.product.create({
            data: {
                ...fields,
                url: product.url,
                sourceId,
                externalId: listing.externalId,
                raw: toJsonInput(listing.raw),
                ...(options.createdAt ? { createdAt: options.createdAt } : {}),
                lastScrapedAt,
            },
            select: { id: true },
        });
        productId = created.id;
    }

    // ── current_bid: only when this scrape carried auction data ──────────────
    if (currentBid) {
        // Nulls are compacted out of the update so a scrape that read only the
        // sale date can't wipe a stored price (and vice versa).
        await tx.currentBid.upsert({
            where: { productId },
            create: { productId, ...currentBid },
            update: compact(currentBid),
            select: { id: true },
        });
    }

    // ── spec: refresh the keys this scrape reported ──────────────────────────
    if (specs.length > 0) {
        // Only the keys present in this scrape are replaced. Deleting every
        // spec first would lose good values whenever a site returns a partial
        // detail page.
        await tx.spec.deleteMany({
            where: { productId, key: { in: specs.map((s) => s.key) } },
        });
        await tx.spec.createMany({
            data: specs.map((s) => ({ productId, key: s.key, value: s.value })),
        });
    }

    // ── product_images: replace the photo set wholesale ──────────────────────
    if (images.length > 0) {
        // Skipped entirely for an empty scrape so existing photos aren't lost.
        await tx.productImage.deleteMany({ where: { productId } });
        await tx.productImage.createMany({
            data: images.map((image, index) => ({
                productId,
                imageUrl: image.imageUrl,
                path: image.path,
                size: image.size,
                isPrimary: image.isPrimary,
                sortOrder: index,
            })),
            // Sites occasionally list the same file twice.
            skipDuplicates: true,
        });
    }

    return {
        productId,
        sourceId,
        ...categoryIds,
        inserted: !existing,
        imageCount: images.length,
        specCount: specs.length,
        bidWritten: currentBid !== null,
    };
}

/** Writes one normalized listing, creating or refreshing the whole product. */
export async function upsertListing(
    listing: NormalizedListing,
    options: UpsertListingOptions = {}
): Promise<UpsertListingResult> {
    const sourceId = await ensureSource(listing.source);
    const categoryIds = await resolveCategory(listing.category, listing.subcategory);
    const prisma: PrismaClient = getPrisma();
    return prisma.$transaction(
        (tx) => upsertListingInTx(tx, sourceId, categoryIds, listing, options),
        TX_OPTIONS
    );
}

/**
 * Normalizes a site's raw scraped record and saves it.
 * This is what the scraper calls: `saveScraped("copart", record)`.
 *
 * Returns null when the record couldn't be normalized into a listing.
 */
export async function saveScraped(
    sourceSlug: string,
    raw: unknown,
    options: UpsertListingOptions = {}
): Promise<UpsertListingResult | null> {
    const listing = normalize(sourceSlug, raw);
    if (!listing) return null;
    return upsertListing(listing, options);
}
