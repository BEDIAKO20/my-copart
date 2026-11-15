import { useCallback, useEffect, useState } from "react";
import { deleteCategoryProducts, deleteProduct, deleteSourceProducts, fetchFilters, fetchProducts, fetchStats } from "./api.ts";
import type { Filters, ProductPage, ProductQuery, Stats } from "./types.ts";
import { formatCompact, formatNumber, formatPrice, timeAgo } from "./format.ts";
import { Card, StatTile } from "./components/Card.tsx";
import { DailyChart } from "./components/DailyChart.tsx";
import { BarList } from "./components/BarList.tsx";
import { ProductTable } from "./components/ProductTable.tsx";
import { ProductDrawer } from "./components/ProductDrawer.tsx";

// How often "Live" mode re-reads the database while a crawl is running.
const LIVE_INTERVAL_MS = 10_000;

const INITIAL_QUERY: ProductQuery = {
    q: "",
    source: "",
    category: "",
    bid: "",
    auctionStatus: "",
    sort: "recent",
    page: 1,
    pageSize: 25,
};

/** Delays a fast-changing value (e.g. the search box) before it triggers a fetch. */
function useDebounced<T>(value: T, ms: number): T {
    const [debounced, setDebounced] = useState(value);
    useEffect(() => {
        const t = setTimeout(() => setDebounced(value), ms);
        return () => clearTimeout(t);
    }, [value, ms]);
    return debounced;
}

export default function App() {
    const [stats, setStats] = useState<Stats | null>(null);
    const [filters, setFilters] = useState<Filters | null>(null);
    const [products, setProducts] = useState<ProductPage | null>(null);
    const [query, setQuery] = useState<ProductQuery>(INITIAL_QUERY);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [live, setLive] = useState(false);
    const [tick, setTick] = useState(0);
    const [openId, setOpenId] = useState<string | null>(null);
    const [deletingSource, setDeletingSource] = useState(false);
    const [deletingCategory, setDeletingCategory] = useState(false);
    const [deletingProductId, setDeletingProductId] = useState<string | null>(null);

    const debouncedQ = useDebounced(query.q, 300);
    const effectiveQuery = { ...query, q: debouncedQ };
    const queryKey = JSON.stringify(effectiveQuery);

    const refresh = useCallback(() => setTick((t) => t + 1), []);

    const handleDeleteSource = useCallback(async (slug: string) => {
        const sourceName = filters?.sources.find((source) => source.slug === slug)?.name ?? slug;
        if (!window.confirm(`Delete every product from ${sourceName}? This cannot be undone.`)) return;

        setDeletingSource(true);
        try {
            const result = await deleteSourceProducts(slug);
            const keptMessage = result.keptWithBids
                ? ` ${result.keptWithBids} product(s) with marketplace bids were kept.`
                : "";
            window.alert(`Deleted ${result.products} product(s) from ${result.source}.${keptMessage}`);
            setQuery((current) => ({ ...current, source: "", page: 1 }));
            refresh();
        } catch (err) {
            setError(err instanceof Error ? err.message : "Could not delete source products");
        } finally {
            setDeletingSource(false);
        }
    }, [filters, refresh]);

    const handleDeleteCategory = useCallback(async (category: string) => {
        if (!window.confirm(`Delete every product in ${category}? This cannot be undone.`)) return;
        setDeletingCategory(true);
        try {
            const result = await deleteCategoryProducts(category);
            const keptMessage = result.keptWithBids
                ? ` ${result.keptWithBids} product(s) with marketplace bids were kept.`
                : "";
            window.alert(`Deleted ${result.products} product(s) in ${category}.${keptMessage}`);
            setQuery((current) => ({ ...current, category: "", page: 1 }));
            refresh();
        } catch (err) {
            setError(err instanceof Error ? err.message : "Could not delete category products");
        } finally {
            setDeletingCategory(false);
        }
    }, [refresh]);

    const handleDeleteProduct = useCallback(async (product: { id: string; name: string | null }) => {
        if (!window.confirm(`Delete ${product.name ?? "this product"}? This also removes its marketplace bid records and cannot be undone.`)) return;
        setDeletingProductId(product.id);
        try {
            const result = await deleteProduct(product.id);
            const keptMessage = result.keptWithBids
                ? " It was kept because it has marketplace bids."
                : "";
            if (result.products > 0) window.alert(`Product deleted.${keptMessage}`);
            else if (result.keptWithBids) window.alert(`Product was not deleted.${keptMessage}`);
            refresh();
        } catch (err) {
            setError(err instanceof Error ? err.message : "Could not delete product");
        } finally {
            setDeletingProductId(null);
        }
    }, [refresh]);

    // Any filter change (other than paging) returns to page 1.
    const updateQuery = useCallback((patch: Partial<ProductQuery>) => {
        setQuery((q) => ({ ...q, ...patch, page: "page" in patch ? patch.page! : 1 }));
    }, []);

    // Stats + filter options
    useEffect(() => {
        const controller = new AbortController();
        Promise.all([fetchStats(controller.signal), fetchFilters(controller.signal)])
            .then(([s, f]) => {
                setStats(s);
                setFilters(f);
                setError(null);
            })
            .catch((err) => !controller.signal.aborted && setError(err.message));
        return () => controller.abort();
    }, [tick]);

    // Product table
    useEffect(() => {
        const controller = new AbortController();
        setLoading(true);
        fetchProducts(JSON.parse(queryKey), controller.signal)
            .then((page) => {
                setProducts(page);
                setError(null);
            })
            .catch((err) => !controller.signal.aborted && setError(err.message))
            .finally(() => !controller.signal.aborted && setLoading(false));
        return () => controller.abort();
    }, [queryKey, tick]);

    // Live mode: poll while a crawl is running.
    useEffect(() => {
        if (!live) return;
        const id = setInterval(refresh, LIVE_INTERVAL_MS);
        return () => clearInterval(id);
    }, [live, refresh]);

    const totals = stats?.totals;

    return (
        <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
            <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-semibold tracking-tight">Scraper Dashboard</h1>
                    <p className="mt-1 text-sm text-stone-500 dark:text-stone-400">
                        Everything the crawler has saved to the database · last scrape{" "}
                        <span className="font-medium text-stone-700 dark:text-stone-300">
                            {timeAgo(stats?.lastScrapedAt)}
                        </span>
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm dark:border-stone-700 dark:bg-stone-900">
                        <input
                            type="checkbox"
                            checked={live}
                            onChange={(e) => setLive(e.target.checked)}
                            className="accent-[var(--color-chart)]"
                        />
                        Live
                        {live && <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" />}
                    </label>
                    <button
                        type="button"
                        onClick={refresh}
                        className="cursor-pointer rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm hover:bg-stone-50 dark:border-stone-700 dark:bg-stone-900 dark:hover:bg-stone-800"
                    >
                        Refresh
                    </button>
                </div>
            </header>

            {error && (
                <div className="mb-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
                    <strong className="font-semibold">Could not load data:</strong> {error}. Is the API running
                    (<code>npm run api</code>)?
                </div>
            )}

            {/* Stat tiles */}
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                <StatTile
                    label="Listings"
                    value={totals ? formatCompact(totals.products) : "—"}
                    detail={totals ? `from ${totals.sources} source${totals.sources === 1 ? "" : "s"}` : undefined}
                />
                <StatTile
                    label="With auction data"
                    value={totals ? formatCompact(totals.withBids) : "—"}
                    detail={
                        totals && totals.products
                            ? `${Math.round((totals.withBids / totals.products) * 100)}% of listings`
                            : undefined
                    }
                />
                <StatTile
                    label="Photos"
                    value={totals ? formatCompact(totals.images) : "—"}
                    detail={
                        totals && totals.products
                            ? `${(totals.images / totals.products).toFixed(1)} per listing`
                            : undefined
                    }
                />
                <StatTile
                    label="Average price"
                    value={formatPrice(totals?.avgPrice)}
                    detail={
                        totals?.minPrice != null
                            ? `${formatPrice(totals.minPrice)} – ${formatPrice(totals.maxPrice)}`
                            : undefined
                    }
                />
            </div>

            {/* Charts */}
            <div className="mt-4 grid gap-4 lg:grid-cols-3">
                <Card title="New listings per day" subtitle="First time each listing was saved, last 14 days" className="lg:col-span-2">
                    {stats ? <DailyChart data={stats.perDay} /> : <div className="h-56" />}
                </Card>
                <div className="grid gap-4">
                    <Card title="By category">
                        <BarList
                            items={(stats?.byCategory ?? []).map((c) => ({
                                key: c.category ?? "",
                                label: c.category ?? "Uncategorized",
                                sublabel: c.subcategories
                                    ? `${c.subcategories} subcategor${c.subcategories === 1 ? "y" : "ies"}`
                                    : null,
                                count: c.count,
                            }))}
                            onSelect={(item) => item.key && updateQuery({ category: item.key })}
                        />
                    </Card>
                    <Card title="By source">
                        <BarList
                            items={(stats?.bySource ?? []).map((s) => ({ key: s.slug, label: s.name, count: s.count }))}
                            onSelect={(item) => updateQuery({ source: item.key })}
                        />
                    </Card>
                </div>
            </div>

            {/* Products */}
            <Card
                title="Listings"
                subtitle={products ? `${formatNumber(products.total)} matching · click a row for photos and full specs` : undefined}
                className="mt-4"
            >
                <ProductTable
                    query={query}
                    onQueryChange={updateQuery}
                    filters={filters}
                    data={products}
                    loading={loading || deletingSource || deletingCategory || deletingProductId !== null}
                    onOpen={setOpenId}
                    onDeleteSource={handleDeleteSource}
                    onDeleteCategory={handleDeleteCategory}
                    onDeleteProduct={handleDeleteProduct}
                    deletingProductId={deletingProductId}
                />
            </Card>

            {openId && <ProductDrawer id={openId} onClose={() => setOpenId(null)} />}
        </div>
    );
}
