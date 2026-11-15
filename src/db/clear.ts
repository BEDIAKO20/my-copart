import { getPrisma } from "./prisma.js";
import { Prisma } from "../generated/prisma/client.js";

export interface ClearResult {
    products: number;
    images: number;
    bids: number;
    specs: number;
    categories: number;
    /** Products kept because customers have placed bids on them. */
    keptWithBids: number;
}

export async function clearMatchingProducts(
    productWhere: Prisma.ProductWhereInput,
    cleanupTaxonomy = false,
    force = false
): Promise<ClearResult> {
    const prisma = getPrisma();

    return prisma.$transaction(async (tx) => {
        const withBids = force
            ? []
            : await tx.$queryRaw<{ product_id: string }[]>`
                  SELECT DISTINCT cb.product_id::text AS product_id
                  FROM bids b JOIN current_bid cb ON cb.id = b.current_bid_id
                  WHERE cb.status = 'OPEN'`;
        const keepIds = withBids.map((r) => r.product_id);
        const where: Prisma.ProductWhereInput = {
            AND: [productWhere, { id: { notIn: keepIds } }],
        };
        const keptWithBids = keepIds.length
            ? await tx.product.count({ where: { AND: [productWhere, { id: { in: keepIds } }] } })
            : 0;

        const used = cleanupTaxonomy
            ? await tx.product.findMany({
                  where,
                  select: { categoryId: true, subcategoryId: true },
                  distinct: ["categoryId", "subcategoryId"],
              })
            : [];
        const categoryIds = [...new Set(used.map((p) => p.categoryId).filter((id): id is string => !!id))];
        const subcategoryIds = [...new Set(used.map((p) => p.subcategoryId).filter((id): id is string => !!id))];

        const productIds = await tx.product.findMany({ where, select: { id: true } });
        if (productIds.length > 0) {
            await tx.$executeRaw`
                DELETE FROM bids
                WHERE current_bid_id IN (
                    SELECT id FROM current_bid
                    WHERE product_id IN (${Prisma.join(productIds.map((product) => product.id))})
                )`;
        }

        const images = await tx.productImage.deleteMany({ where: { product: where } });
        const bids = await tx.currentBid.deleteMany({ where: { product: where } });
        const specs = await tx.spec.deleteMany({ where: { product: where } });
        const products = await tx.product.deleteMany({ where });

        let categories = 0;
        if (cleanupTaxonomy) {
            await tx.subcategory.deleteMany({
                where: { id: { in: subcategoryIds }, products: { none: {} } },
            });
            categories = (
                await tx.category.deleteMany({
                    where: { id: { in: categoryIds }, products: { none: {} }, subcategories: { none: {} } },
                })
            ).count;
        }

        return { products: products.count, images: images.count, bids: bids.count, specs: specs.count, categories, keptWithBids };
    }, { maxWait: 20_000, timeout: 60_000 });
}

/**
 * Deletes every product whose source is Copart — matched by the source's slug
 * ("copart") or its display name ("Copart", any casing) — together with its
 * images, bid and specs. Products from every other source are left untouched.
 *
 * Categories/subcategories are only removed if a deleted Copart product used
 * them AND nothing else uses them any more, so other sources' taxonomy is never
 * touched.
 *
 * Products that customers have bid on (the marketplace app's `bids` table,
 * which blocks deleting their current_bid) are kept; the crawl then updates
 * them in place.
 */
export async function clearSourceProducts(slug: string, name: string): Promise<ClearResult> {
    return clearMatchingProducts({
            source: {
                OR: [{ slug }, { name: { equals: name, mode: "insensitive" as const } }],
            },
        }, true);
}

export const clearCategoryProducts = (categoryName: string) =>
    clearMatchingProducts({ categoryName });
