/**
 * Read-only HTTP API behind the dashboard (dashboard/).
 *
 *   npm run api          # http://localhost:4000  (PORT=… to change)
 *
 * Also serves the images the crawler downloads into storage/images/ and, once
 * built with `npm run dashboard:build`, the dashboard itself. (Not port 3000:
 * a VPN service on this machine already listens there.)
 *
 * Endpoints:
 *   GET /api/stats          totals, per-source / per-category counts, listings per day
 *   GET /api/filters        sources and categories for the filter dropdowns
 *   GET /api/products       paginated, filterable product list
 *   GET /api/products/:id   one product with every image and spec
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { getPrisma, disconnectPrisma, isDbConfigured } from "./db/prisma.js";
import { clearCategoryProducts, clearMatchingProducts, clearSourceProducts } from "./db/clear.js";
import type { Prisma } from "./generated/prisma/client.js";

const PORT = Number(process.env.PORT ?? 4000);
const HOST = process.env.HOST ?? "127.0.0.1";

const IMAGES_DIR = path.resolve("storage/images");
const DASHBOARD_DIR = path.resolve("dashboard/dist");

// Specs the product table can show; everything else is detail-only. Sites
// name things differently, so the table picks whichever of these a row has.
const LIST_SPEC_KEYS = ["Odometer", "Mileage", "Primary Damage", "Condition", "Brand", "Part #", "Location"];

const MIME: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".ico": "image/x-icon",
    ".json": "application/json",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Prisma Decimal / BigInt -> plain number so JSON stays numeric. */
function num(value: unknown): number | null {
    if (value === null || value === undefined) return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
    res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
    res.end(JSON.stringify(body));
}

/** Prefer the crawler's local copy of an image; fall back to the remote URL. */
function imageSrc(image: { imageUrl: string; path: string | null }): { src: string; remote: string } {
    const local = image.path?.replace(/\\/g, "/").replace(/^\/+/, "");
    return { src: local ? `/${local}` : image.imageUrl, remote: image.imageUrl };
}

/** Streams a file from inside `root`, refusing anything that escapes it. */
async function serveFile(res: ServerResponse, root: string, relative: string): Promise<boolean> {
    const filePath = path.resolve(root, "." + path.posix.normalize("/" + relative));
    if (filePath !== root && !filePath.startsWith(root + path.sep)) return false;
    try {
        const info = await stat(filePath);
        if (!info.isFile()) return false;
        res.writeHead(200, {
            "Content-Type": MIME[path.extname(filePath).toLowerCase()] ?? "application/octet-stream",
            "Content-Length": info.size,
        });
        createReadStream(filePath).pipe(res);
        return true;
    } catch {
        return false;
    }
}

// ─── Handlers ─────────────────────────────────────────────────────────────────

async function getStats() {
    const prisma = getPrisma();

    const [products, withBids, images, lastScraped, priceAgg, sources, categories, perDay] = await Promise.all([
        prisma.product.count(),
        prisma.currentBid.count(),
        prisma.productImage.count(),
        prisma.product.findFirst({ orderBy: { lastScrapedAt: "desc" }, select: { lastScrapedAt: true } }),
        prisma.product.aggregate({ _avg: { price: true }, _min: { price: true }, _max: { price: true } }),
        prisma.source.findMany({
            select: { slug: true, name: true, _count: { select: { products: true } } },
            orderBy: { name: "asc" },
        }),
        prisma.$queryRaw<{ category: string | null; subcategories: bigint; n: bigint }[]>`
            SELECT category_name AS category, COUNT(DISTINCT subcategory_id) AS subcategories, COUNT(*) AS n
            FROM products
            GROUP BY category_name
            ORDER BY n DESC`,
        // New listings per day over the last 14 days (by first time seen).
        prisma.$queryRaw<{ day: Date; n: bigint }[]>`
            SELECT date_trunc('day', created_at) AS day, COUNT(*) AS n
            FROM products
            WHERE created_at >= date_trunc('day', now()) - interval '13 days'
            GROUP BY 1
            ORDER BY 1`,
    ]);

    // Fill in empty days so the chart has a bar slot for every day.
    const byDay = new Map(perDay.map((r) => [new Date(r.day).toISOString().slice(0, 10), Number(r.n)]));
    const days: { day: string; count: number }[] = [];
    const today = new Date();
    for (let i = 13; i >= 0; i--) {
        const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - i));
        const key = d.toISOString().slice(0, 10);
        days.push({ day: key, count: byDay.get(key) ?? 0 });
    }

    return {
        totals: {
            products,
            withBids,
            images,
            sources: sources.length,
            avgPrice: num(priceAgg._avg.price),
            minPrice: num(priceAgg._min.price),
            maxPrice: num(priceAgg._max.price),
        },
        lastScrapedAt: lastScraped?.lastScrapedAt ?? null,
        bySource: sources.map((s) => ({ slug: s.slug, name: s.name, count: s._count.products })),
        byCategory: categories.map((c) => ({
            category: c.category,
            subcategories: Number(c.subcategories),
            count: Number(c.n),
        })),
        perDay: days,
    };
}

async function getFilters() {
    const prisma = getPrisma();
    const [sources, categories] = await Promise.all([
        prisma.source.findMany({ select: { slug: true, name: true }, orderBy: { name: "asc" } }),
        prisma.category.findMany({
            select: { name: true, subcategories: { select: { name: true }, orderBy: { name: "asc" } } },
            orderBy: { name: "asc" },
        }),
    ]);
    return {
        sources,
        categories: categories.map((c) => ({ name: c.name, subcategories: c.subcategories.map((s) => s.name) })),
    };
}

const SORTS: Record<string, Prisma.ProductOrderByWithRelationInput[]> = {
    recent: [{ lastScrapedAt: "desc" }],
    oldest: [{ lastScrapedAt: "asc" }],
    price_desc: [{ price: { sort: "desc", nulls: "last" } }],
    price_asc: [{ price: { sort: "asc", nulls: "last" } }],
    name: [{ name: "asc" }],
};

async function listProducts(params: URLSearchParams) {
    const prisma = getPrisma();

    const page = Math.max(1, Number(params.get("page")) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(params.get("pageSize")) || 25));
    const q = params.get("q")?.trim();
    const source = params.get("source")?.trim();
    const category = params.get("category")?.trim();
    const subcategory = params.get("subcategory")?.trim();
    const bid = params.get("bid")?.trim(); // "buyItNow" | "bidNow"
    const auctionStatus = params.get("auctionStatus")?.trim(); // "live" | "ended"

    const and: Prisma.ProductWhereInput[] = [];
    if (q) {
        and.push({
            OR: [
                { name: { contains: q, mode: "insensitive" } },
                { externalId: { contains: q } },
                { specs: { some: { key: "VIN", value: { contains: q, mode: "insensitive" } } } },
            ],
        });
    }
    if (source) and.push({ source: { slug: source } });
    if (category) and.push({ categoryName: category });
    if (subcategory) and.push({ subcategory: { name: subcategory } });
    if (bid === "buyItNow") and.push({ currentBid: { buyItNow: true } });
    if (bid === "bidNow") and.push({ currentBid: { bidNow: true } });
    if (auctionStatus === "live") and.push({ currentBid: { status: "OPEN" } });
    if (auctionStatus === "ended") and.push({ currentBid: { status: { in: ["ENDED", "CANCELLED"] } } });
    const where: Prisma.ProductWhereInput = and.length ? { AND: and } : {};

    const [total, rows] = await Promise.all([
        prisma.product.count({ where }),
        prisma.product.findMany({
            where,
            orderBy: SORTS[params.get("sort") ?? ""] ?? SORTS.recent,
            skip: (page - 1) * pageSize,
            take: pageSize,
            include: {
                source: { select: { slug: true, name: true } },
                subcategory: { select: { name: true } },
                currentBid: true,
                images: { orderBy: [{ isPrimary: "desc" }, { sortOrder: "asc" }], take: 1 },
                specs: { where: { key: { in: LIST_SPEC_KEYS } }, select: { key: true, value: true } },
                _count: { select: { images: true } },
            },
        }),
    ]);

    return {
        page,
        pageSize,
        total,
        items: rows.map((p) => ({
            id: p.id,
            name: p.name,
            externalId: p.externalId,
            url: p.url,
            price: num(p.price),
            source: p.source,
            category: p.categoryName,
            subcategory: p.subcategory?.name ?? null,
            lastScrapedAt: p.lastScrapedAt,
            createdAt: p.createdAt,
            image: p.images[0] ? imageSrc(p.images[0]) : null,
            imageCount: p._count.images,
            specs: Object.fromEntries(p.specs.map((s) => [s.key, s.value])),
            currentBid: p.currentBid && {
                lotNumber: p.currentBid.lotNumber,
                price: num(p.currentBid.price),
                currency: p.currentBid.currency,
                bidNow: p.currentBid.bidNow,
                buyItNow: p.currentBid.buyItNow,
                saleDate: p.currentBid.saleDate,
                saleName: p.currentBid.saleName,
                status: p.currentBid.status,
            },
        })),
    };
}

async function getProduct(id: string) {
    const prisma = getPrisma();
    const p = await prisma.product.findUnique({
        where: { id },
        include: {
            source: { select: { slug: true, name: true, url: true } },
            subcategory: { select: { name: true } },
            currentBid: true,
            images: { orderBy: { sortOrder: "asc" } },
            specs: { orderBy: { key: "asc" }, select: { key: true, value: true } },
        },
    });
    if (!p) return null;
    return {
        id: p.id,
        name: p.name,
        brand: p.brand,
        description: p.description,
        externalId: p.externalId,
        url: p.url,
        price: num(p.price),
        source: p.source,
        category: p.categoryName,
        subcategory: p.subcategory?.name ?? null,
        createdAt: p.createdAt,
        lastScrapedAt: p.lastScrapedAt,
        images: p.images.map((img) => ({ ...imageSrc(img), isPrimary: img.isPrimary })),
        specs: p.specs,
        currentBid: p.currentBid && {
            lotNumber: p.currentBid.lotNumber,
            price: num(p.currentBid.price),
            currency: p.currentBid.currency,
            bidNow: p.currentBid.bidNow,
            buyItNow: p.currentBid.buyItNow,
            pureSale: p.currentBid.pureSale,
            saleDate: p.currentBid.saleDate,
            saleName: p.currentBid.saleName,
            status: p.currentBid.status,
        },
    };
}

async function deleteSourceProducts(slug: string) {
    const prisma = getPrisma();
    const source = await prisma.source.findUnique({ where: { slug }, select: { name: true } });
    if (!source) return null;
    return { source: source.name, ...(await clearSourceProducts(slug, source.name)) };
}

async function deleteCategoryProducts(categoryName: string) {
    return clearCategoryProducts(categoryName);
}

// ─── Router ───────────────────────────────────────────────────────────────────

const UUID_RE = /^[0-9a-f-]{36}$/i;

async function handle(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? "/", "http://localhost");
    const pathname = decodeURIComponent(url.pathname);

    if (pathname.startsWith("/api/")) {
        if (!isDbConfigured()) {
            return sendJson(res, 503, { error: "DATABASE_URL is not set in .env" });
        }
        const deleteSourceMatch = pathname.match(/^\/api\/sources\/([^/]+)\/products$/);
        if (req.method === "DELETE" && deleteSourceMatch) {
            const result = await deleteSourceProducts(deleteSourceMatch[1]);
            return result ? sendJson(res, 200, result) : sendJson(res, 404, { error: "Source not found" });
        }
        const deleteCategoryMatch = pathname.match(/^\/api\/categories\/([^/]+)\/products$/);
        if (req.method === "DELETE" && deleteCategoryMatch) {
            return sendJson(res, 200, await deleteCategoryProducts(deleteCategoryMatch[1]));
        }
        const deleteProductMatch = pathname.match(/^\/api\/products\/([^/]+)$/);
        if (req.method === "DELETE" && deleteProductMatch) {
            if (!UUID_RE.test(deleteProductMatch[1])) return sendJson(res, 404, { error: "Product not found" });
            return sendJson(res, 200, await clearMatchingProducts({ id: deleteProductMatch[1] }, false, true));
        }
        if (req.method !== "GET" && req.method !== "HEAD") {
            return sendJson(res, 405, { error: "Method not allowed" });
        }
        if (pathname === "/api/stats") return sendJson(res, 200, await getStats());
        if (pathname === "/api/filters") return sendJson(res, 200, await getFilters());
        if (pathname === "/api/products") return sendJson(res, 200, await listProducts(url.searchParams));

        const match = pathname.match(/^\/api\/products\/([^/]+)$/);
        if (match) {
            if (!UUID_RE.test(match[1])) return sendJson(res, 404, { error: "Product not found" });
            const product = await getProduct(match[1]);
            return product ? sendJson(res, 200, product) : sendJson(res, 404, { error: "Product not found" });
        }
        return sendJson(res, 404, { error: "Unknown endpoint" });
    }

    if (pathname.startsWith("/storage/images/")) {
        if (await serveFile(res, IMAGES_DIR, pathname.slice("/storage/images/".length))) return;
        res.writeHead(404).end();
        return;
    }

    // The built dashboard, with index.html as the fallback for client routes.
    if (await serveFile(res, DASHBOARD_DIR, pathname === "/" ? "index.html" : pathname.slice(1))) return;
    if (await serveFile(res, DASHBOARD_DIR, "index.html")) return;

    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Dashboard not built yet. Run `npm run dashboard` for development, or `npm run dashboard:build`.");
}

const server = createServer((req, res) => {
    handle(req, res).catch((err) => {
        console.error(`${req.method} ${req.url} failed:`, err);
        if (!res.headersSent) sendJson(res, 500, { error: (err as Error).message });
        else res.end();
    });
});

server.listen(PORT, HOST, () => {
    console.log(`Dashboard API listening on http://localhost:${PORT}`);
    if (!isDbConfigured()) console.warn("DATABASE_URL is not set — /api/* will return 503.");
});

async function shutdown() {
    server.close();
    await disconnectPrisma();
    process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
