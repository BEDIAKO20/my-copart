import type { Filters, ProductPage, ProductQuery, ProductSummary } from "../types.ts";
import { formatDate, formatNumber, formatPrice, timeAgo } from "../format.ts";
import { Img } from "./Img.tsx";

const inputClass =
    "h-9 rounded-lg border border-stone-300 bg-white px-3 text-sm outline-none focus:border-chart focus:ring-2 focus:ring-chart/20 dark:border-stone-700 dark:bg-stone-900";

export function BidBadge({ product }: { product: Pick<ProductSummary, "currentBid"> }) {
    const bid = product.currentBid;
    if (!bid) return null;
    if (bid.buyItNow) {
        return (
            <span className="whitespace-nowrap rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700 ring-1 ring-emerald-600/20 dark:bg-emerald-950 dark:text-emerald-300">
                Buy It Now
            </span>
        );
    }
    if (bid.bidNow) {
        return (
            <span className="whitespace-nowrap rounded-full bg-sky-50 px-2 py-0.5 text-[11px] font-medium text-sky-700 ring-1 ring-sky-600/20 dark:bg-sky-950 dark:text-sky-300">
                Current bid
            </span>
        );
    }
    return null;
}

// Each site names its specs differently; show the first two a listing has.
const DETAIL_KEYS = ["Odometer", "Mileage", "Primary Damage", "Condition", "Brand", "Part #"];

function details(specs: Record<string, string>): string {
    const values = DETAIL_KEYS.filter((k) => specs[k]).map((k) => (k === "Part #" ? `Part #${specs[k]}` : specs[k]));
    return values.slice(0, 2).join(" · ") || "—";
}

export function ProductTable({
    query,
    onQueryChange,
    filters,
    data,
    loading,
    onOpen,
    onDeleteSource,
    onDeleteCategory,
    onDeleteProduct,
    deletingProductId,
}: {
    query: ProductQuery;
    onQueryChange: (patch: Partial<ProductQuery>) => void;
    filters: Filters | null;
    data: ProductPage | null;
    loading: boolean;
    onOpen: (id: string) => void;
    onDeleteSource: (slug: string) => void;
    onDeleteCategory: (name: string) => void;
    onDeleteProduct: (product: ProductSummary) => void;
    deletingProductId: string | null;
}) {
    const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
    const from = data && data.total > 0 ? (data.page - 1) * data.pageSize + 1 : 0;
    const to = data ? Math.min(data.page * data.pageSize, data.total) : 0;

    return (
        <div>
            {/* Filters — one row above the table */}
            <div className="mb-4 flex flex-wrap items-center gap-2">
                <input
                    type="search"
                    value={query.q}
                    onChange={(e) => onQueryChange({ q: e.target.value })}
                    placeholder="Search name, ID / lot # or VIN…"
                    className={`${inputClass} w-full sm:w-64`}
                />
                <select
                    value={query.source}
                    onChange={(e) => onQueryChange({ source: e.target.value })}
                    className={inputClass}
                >
                    <option value="">All sources</option>
                    {filters?.sources.map((s) => (
                        <option key={s.slug} value={s.slug}>{s.name}</option>
                    ))}
                </select>
                <button
                    type="button"
                    disabled={!query.category}
                    onClick={() => onDeleteCategory(query.category)}
                    className={`${inputClass} border-red-300 text-red-700 enabled:cursor-pointer enabled:hover:bg-red-50 disabled:opacity-40 dark:border-red-900 dark:text-red-300 dark:enabled:hover:bg-red-950`}
                >
                    Delete category products
                </button>
                <button
                    type="button"
                    disabled={!query.source}
                    onClick={() => onDeleteSource(query.source)}
                    className={`${inputClass} border-red-300 text-red-700 enabled:cursor-pointer enabled:hover:bg-red-50 disabled:opacity-40 dark:border-red-900 dark:text-red-300 dark:enabled:hover:bg-red-950`}
                >
                    Delete source products
                </button>
                <select
                    value={query.category}
                    onChange={(e) => onQueryChange({ category: e.target.value })}
                    className={inputClass}
                >
                    <option value="">All categories</option>
                    {filters?.categories.map((c) => (
                        <option key={c.name} value={c.name}>{c.name}</option>
                    ))}
                </select>
                <select
                    value={query.bid}
                    onChange={(e) => onQueryChange({ bid: e.target.value as ProductQuery["bid"] })}
                    className={inputClass}
                >
                    <option value="">Any sale type</option>
                    <option value="buyItNow">Buy It Now</option>
                    <option value="bidNow">Current bid</option>
                </select>
                <select
                    value={query.auctionStatus}
                    onChange={(e) => onQueryChange({ auctionStatus: e.target.value as ProductQuery["auctionStatus"] })}
                    className={inputClass}
                >
                    <option value="">Any auction status</option>
                    <option value="live">Live auctions</option>
                    <option value="ended">Ended auctions</option>
                </select>
                <select
                    value={query.sort}
                    onChange={(e) => onQueryChange({ sort: e.target.value as ProductQuery["sort"] })}
                    className={inputClass}
                >
                    <option value="recent">Recently scraped</option>
                    <option value="oldest">Oldest scraped</option>
                    <option value="price_desc">Price: high to low</option>
                    <option value="price_asc">Price: low to high</option>
                    <option value="name">Name A–Z</option>
                </select>
                {loading && <span className="text-xs text-stone-400">Loading…</span>}
            </div>

            <div className="overflow-x-auto rounded-lg border border-stone-200 dark:border-stone-800">
                <table className="w-full min-w-[900px] text-left text-sm">
                    <thead className="bg-stone-50 text-xs text-stone-500 dark:bg-stone-900/60 dark:text-stone-400">
                        <tr>
                            <th className="px-3 py-2.5 font-medium">Listing</th>
                            <th className="px-3 py-2.5 text-right font-medium">Price</th>
                            <th className="px-3 py-2.5 font-medium">Category</th>
                            <th className="px-3 py-2.5 font-medium">Details</th>
                            <th className="px-3 py-2.5 font-medium">Location</th>
                            <th className="px-3 py-2.5 font-medium">Sale date</th>
                            <th className="px-3 py-2.5 font-medium">Scraped</th>
                            <th className="px-3 py-2.5 text-right font-medium">Action</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-stone-100 dark:divide-stone-800">
                        {data?.items.map((p) => (
                            <tr
                                key={p.id}
                                onClick={() => onOpen(p.id)}
                                className="cursor-pointer hover:bg-stone-50 dark:hover:bg-stone-800/50"
                            >
                                <td className="px-3 py-2">
                                    <div className="flex items-center gap-3">
                                        <Img image={p.image} alt="" className="h-12 w-16 shrink-0 rounded-md" />
                                        <div className="min-w-0">
                                            <div className="max-w-xs truncate font-medium">{p.name ?? "Untitled"}</div>
                                            <div className="max-w-xs truncate text-xs text-stone-500 dark:text-stone-400">
                                                {p.source.name} · #{p.externalId}
                                            </div>
                                        </div>
                                    </div>
                                </td>
                                <td className="px-3 py-2 text-right">
                                    <div className="font-medium tabular-nums">{formatPrice(p.price)}</div>
                                    <BidBadge product={p} />
                                </td>
                                <td className="whitespace-nowrap px-3 py-2 text-stone-600 dark:text-stone-300">
                                    <div>{p.category ?? "—"}</div>
                                    {p.subcategory && <div className="text-xs text-stone-400">{p.subcategory}</div>}
                                </td>
                                <td className="max-w-56 truncate px-3 py-2 text-stone-600 dark:text-stone-300">{details(p.specs)}</td>
                                <td className="max-w-48 truncate px-3 py-2 text-stone-600 dark:text-stone-300">{p.specs.Location ?? "—"}</td>
                                <td className="px-3 py-2 whitespace-nowrap text-stone-600 dark:text-stone-300">
                                    {formatDate(p.currentBid?.saleDate)}
                                </td>
                                <td className="px-3 py-2 whitespace-nowrap text-stone-500 dark:text-stone-400" title={p.lastScrapedAt}>
                                    {timeAgo(p.lastScrapedAt)}
                                </td>
                                <td className="px-3 py-2 text-right">
                                    <button
                                        type="button"
                                        onClick={(event) => {
                                            event.stopPropagation();
                                            onDeleteProduct(p);
                                        }}
                                        disabled={deletingProductId !== null}
                                        className="cursor-pointer rounded-md border border-red-300 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-50 disabled:cursor-wait disabled:opacity-50 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-950"
                                    >
                                        {deletingProductId === p.id ? "Deleting…" : "Delete"}
                                    </button>
                                </td>
                            </tr>
                        ))}
                        {data && data.items.length === 0 && (
                            <tr>
                                <td colSpan={8} className="px-3 py-10 text-center text-stone-500">
                                    No listings match these filters.
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>

            {/* Pagination */}
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm text-stone-500 dark:text-stone-400">
                <span>
                    {data ? `${formatNumber(from)}–${formatNumber(to)} of ${formatNumber(data.total)}` : "—"}
                </span>
                <div className="flex items-center gap-2">
                    <select
                        value={query.pageSize}
                        onChange={(e) => onQueryChange({ pageSize: Number(e.target.value) })}
                        className={inputClass}
                    >
                        {[25, 50, 100].map((n) => (
                            <option key={n} value={n}>{n} / page</option>
                        ))}
                    </select>
                    <button
                        type="button"
                        disabled={query.page <= 1}
                        onClick={() => onQueryChange({ page: query.page - 1 })}
                        className={`${inputClass} enabled:cursor-pointer enabled:hover:bg-stone-50 disabled:opacity-40 dark:enabled:hover:bg-stone-800`}
                    >
                        Previous
                    </button>
                    <span className="tabular-nums">
                        Page {query.page} of {pages}
                    </span>
                    <button
                        type="button"
                        disabled={query.page >= pages}
                        onClick={() => onQueryChange({ page: query.page + 1 })}
                        className={`${inputClass} enabled:cursor-pointer enabled:hover:bg-stone-50 disabled:opacity-40 dark:enabled:hover:bg-stone-800`}
                    >
                        Next
                    </button>
                </div>
            </div>
        </div>
    );
}
