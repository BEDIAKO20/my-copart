/**
 * Prints what is actually in the database, so a migration or crawl can be
 * confirmed rather than assumed.
 *
 *   npm run db:check
 */
import { getPrisma, disconnectPrisma, isDbConfigured } from "./prisma.js";
import { assertDatabaseReady } from "./preflight.js";

async function main() {
    if (!isDbConfigured()) {
        console.error("DATABASE_URL is not set — nothing to check.");
        process.exitCode = 1;
        return;
    }

    const info = await assertDatabaseReady();
    console.log(`Connected: ${info.database} on ${info.host} (schema ${info.schema}, user ${info.user})\n`);

    const prisma = getPrisma();

    const counts = {
        products: await prisma.product.count(),
        category: await prisma.category.count(),
        subcategory: await prisma.subcategory.count(),
        source: await prisma.source.count(),
        product_images: await prisma.productImage.count(),
        current_bid: await prisma.currentBid.count(),
        spec: await prisma.spec.count(),
    };

    console.log("─── row counts ─────────────────────────────────────────────");
    console.log(`  products ⭐    ${counts.products}`);
    console.log(`  category       ${counts.category}`);
    console.log(`  subcategory    ${counts.subcategory}`);
    console.log(`  source         ${counts.source}`);
    console.log(`  product_images ${counts.product_images}`);
    console.log(`  current_bid    ${counts.current_bid}`);
    console.log(`  spec           ${counts.spec}`);

    if (counts.products === 0) {
        console.log("\n`products` is empty. Run `npm run db:import` to load scraped JSON, or `npm start` to crawl.");
        return;
    }

    // ── Per-source breakdown: proof that many sites share one `products` table ──
    const sources = await prisma.source.findMany({
        select: { slug: true, name: true, type: true, _count: { select: { products: true } } },
        orderBy: { slug: "asc" },
    });
    console.log("\n─── products per source ────────────────────────────────────");
    for (const s of sources) {
        console.log(`  ${s.slug.padEnd(14)} ${String(s._count.products).padStart(5)} product(s)  "${s.name}" [${s.type}]`);
    }

    // ── Categories, grouped by the source that owns them ─────────────────────
    // The database is shared by several scrapers, so a category is only
    // meaningful next to the site its products came from.
    const categoryRows = await prisma.$queryRaw<
        { slug: string; source: string; category: string | null; subcategory: string | null; n: bigint }[]
    >`
        SELECT s.slug, s.name AS source, c.name AS category, sc.name AS subcategory, COUNT(*) AS n
        FROM products p
        JOIN source s ON s.id = p.source_id
        LEFT JOIN category c ON c.id = p.category_id
        LEFT JOIN subcategory sc ON sc.id = p.subcategory_id
        GROUP BY s.slug, s.name, c.name, sc.name
        ORDER BY s.slug, c.name, sc.name`;

    console.log("\n─── categories per source ──────────────────────────────────");
    let lastSlug = "";
    let lastCategory: string | null | undefined;
    for (const row of categoryRows) {
        if (row.slug !== lastSlug) {
            console.log(`  [${row.slug}] ${row.source}`);
            lastSlug = row.slug;
            lastCategory = undefined;
        }
        if (row.category !== lastCategory) {
            const total = categoryRows
                .filter((r) => r.slug === row.slug && r.category === row.category)
                .reduce((sum, r) => sum + Number(r.n), 0);
            console.log(`    ${row.category ?? "(no category)"} (${total} product(s))`);
            lastCategory = row.category;
        }
        if (row.subcategory) {
            console.log(`      ${row.subcategory} (${Number(row.n)} product(s))`);
        }
    }

    // ── Integrity checks ─────────────────────────────────────────────────────
    console.log("\n─── integrity ──────────────────────────────────────────────");

    const dupes = await prisma.$queryRaw<{ source_id: string; external_id: string; n: bigint }[]>`
        SELECT source_id, external_id, COUNT(*) AS n
        FROM products GROUP BY source_id, external_id HAVING COUNT(*) > 1`;
    console.log(`  duplicate (source_id, external_id): ${dupes.length}`);

    // A subcategory must belong to the product's own category.
    const mismatched = await prisma.$queryRaw<{ n: bigint }[]>`
        SELECT COUNT(*) AS n FROM products p JOIN subcategory s ON s.id = p.subcategory_id
        WHERE p.category_id IS DISTINCT FROM s.category_id`;
    const mismatchedCount = Number(mismatched[0]?.n ?? 0);
    console.log(`  subcategory outside its category:   ${mismatchedCount}`);

    const noImages = await prisma.product.count({ where: { images: { none: {} } } });
    const noPrimary = await prisma.product.count({
        where: { images: { some: {} }, AND: { images: { none: { isPrimary: true } } } },
    });
    const noBid = await prisma.product.count({ where: { currentBid: null } });
    const noSpecs = await prisma.product.count({ where: { specs: { none: {} } } });
    const noCategory = await prisma.product.count({ where: { categoryId: null } });
    const noPrice = await prisma.product.count({ where: { price: null } });

    console.log(`  products with no images:            ${noImages}`);
    console.log(`  products with images but no primary: ${noPrimary}`);
    console.log(`  products with no price:             ${noPrice}`);
    console.log(`  products with no current_bid row:   ${noBid}`);
    console.log(`  products with no specs:             ${noSpecs}`);
    console.log(`  products with no category link:     ${noCategory}`);

    // ── Sample ───────────────────────────────────────────────────────────────
    const sample = await prisma.product.findFirst({
        orderBy: { lastScrapedAt: "desc" },
        include: {
            source: { select: { slug: true, name: true } },
            category: { select: { name: true } },
            subcategory: { select: { name: true } },
            currentBid: true,
            images: { orderBy: { sortOrder: "asc" }, take: 3 },
            specs: { orderBy: { key: "asc" } },
            _count: { select: { images: true, specs: true } },
        },
    });

    if (sample) {
        console.log("\n─── most recently scraped product ──────────────────────────");
        console.log(`  id            ${sample.id}`);
        console.log(`  source        ${sample.source.name} (${sample.source.slug})`);
        console.log(`  external_id   ${sample.externalId}`);
        console.log(`  name          ${sample.name}`);
        console.log(`  brand         ${sample.brand ?? "—"}`);
        console.log(`  price         ${sample.price ?? "—"}`);
        console.log(`  sku / part #  ${sample.sku ?? "—"} / ${sample.partNumber ?? "—"}`);
        console.log(`  rating        ${sample.rating ?? "—"}`);
        console.log(`  category_name ${sample.categoryName ?? "—"}  (no join needed)`);
        console.log(`  category      ${sample.category?.name ?? "—"} > ${sample.subcategory?.name ?? "—"}`);
        console.log(`  url           ${sample.url}`);
        console.log(
            sample.currentBid
                ? `  current_bid   lot_number=${sample.currentBid.lotNumber ?? "—"} ` +
                      `price=${sample.currentBid.price ?? "—"} ${sample.currentBid.currency} ` +
                      `bid_now=${sample.currentBid.bidNow} buy_it_now=${sample.currentBid.buyItNow} ` +
                      `pure_sale=${sample.currentBid.pureSale} auctions=${sample.currentBid.auctions} ` +
                      `sale_date=${sample.currentBid.saleDate?.toISOString() ?? "—"} status=${sample.currentBid.status}`
                : "  current_bid   —"
        );
        console.log(`  images        ${sample._count.images} (showing ${sample.images.length})`);
        for (const img of sample.images) {
            console.log(`      [${img.sortOrder}]${img.isPrimary ? " PRIMARY" : "        "} ${img.imageUrl}`);
        }
        console.log(`  specs         ${sample._count.specs}`);
        for (const spec of sample.specs) {
            console.log(`      ${spec.key.padEnd(18)} ${spec.value}`);
        }
    }

    const problems = dupes.length + mismatchedCount;
    console.log(
        `\n${problems === 0 ? "PASS" : "FAIL"}: ${
            problems === 0
                ? "no duplicate listings, categories consistent"
                : `${dupes.length} duplicate listing group(s), ${mismatchedCount} category mismatch(es)`
        }.`
    );
    if (problems > 0) process.exitCode = 1;
}

main()
    .catch((err) => {
        console.error(`Check failed: ${(err as Error).message}`);
        process.exitCode = 1;
    })
    .finally(disconnectPrisma);
