import { getPrisma } from "./prisma.js";

/**
 * Get-or-create for `category` and `subcategory`.
 *
 * ("Electronics", "Laptops") becomes the category "Electronics" with the
 * subcategory "Laptops" beneath it. Every site funnels through here, so two
 * sites both selling laptops share one category/subcategory pair instead of
 * each inventing their own.
 *
 * Runs OUTSIDE the product transaction on purpose: in Postgres a unique
 * violation aborts the surrounding transaction, so the "someone else created
 * it first, re-read it" recovery below only works on its own connection. An
 * orphan category left behind by a failed product write is harmless.
 */

/** Used when a site gives a subcategory but no category to hang it under. */
const FALLBACK_CATEGORY = "Uncategorized";

// Categories never change during a run, so caching them keeps the per-listing
// write down to the product itself.
const categoryCache = new Map<string, string>();
const subcategoryCache = new Map<string, string>();

/** Clears the process-level caches. Only needed by tests. */
export function resetCategoryCache(): void {
    categoryCache.clear();
    subcategoryCache.clear();
}

function isUniqueViolation(err: unknown): boolean {
    return (err as { code?: string }).code === "P2002";
}

async function ensureCategory(name: string): Promise<string> {
    const cached = categoryCache.get(name);
    if (cached !== undefined) return cached;

    const prisma = getPrisma();
    const existing = await prisma.category.findUnique({ where: { name }, select: { id: true } });
    let id = existing?.id;
    if (!id) {
        try {
            id = (await prisma.category.create({ data: { name }, select: { id: true } })).id;
        } catch (err) {
            // Another writer created it first — re-read instead of failing.
            if (!isUniqueViolation(err)) throw err;
            id = (await prisma.category.findUniqueOrThrow({ where: { name }, select: { id: true } })).id;
        }
    }
    categoryCache.set(name, id);
    return id;
}

async function ensureSubcategory(categoryId: string, name: string): Promise<string> {
    const key = `${categoryId} ${name}`;
    const cached = subcategoryCache.get(key);
    if (cached !== undefined) return cached;

    const prisma = getPrisma();
    const where = { categoryId_name: { categoryId, name } };
    const existing = await prisma.subcategory.findUnique({ where, select: { id: true } });
    let id = existing?.id;
    if (!id) {
        try {
            id = (
                await prisma.subcategory.create({ data: { categoryId, name }, select: { id: true } })
            ).id;
        } catch (err) {
            if (!isUniqueViolation(err)) throw err;
            id = (await prisma.subcategory.findUniqueOrThrow({ where, select: { id: true } })).id;
        }
    }
    subcategoryCache.set(key, id);
    return id;
}

function clean(value: string | null | undefined): string | null {
    const trimmed = typeof value === "string" ? value.trim() : "";
    return trimmed || null;
}

/**
 * Resolves scraped category/subcategory names to ids, creating any that are
 * missing. Either id is null when the site gave us nothing for that level.
 *
 * Also returns `categoryName` — the plain text, e.g. "Vehicles" — so callers
 * can store it directly on `products.category_name` alongside `categoryId`
 * without a second lookup; it's already sitting right here as `catName`.
 */
export async function resolveCategory(
    category: string | null | undefined,
    subcategory: string | null | undefined
): Promise<{ categoryId: string | null; categoryName: string | null; subcategoryId: string | null }> {
    const subName = clean(subcategory);
    const catName = clean(category) ?? (subName ? FALLBACK_CATEGORY : null);
    if (!catName) return { categoryId: null, categoryName: null, subcategoryId: null };

    const categoryId = await ensureCategory(catName);
    const subcategoryId = subName ? await ensureSubcategory(categoryId, subName) : null;
    return { categoryId, categoryName: catName, subcategoryId };
}
