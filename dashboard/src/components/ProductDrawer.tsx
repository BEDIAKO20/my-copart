import { useEffect, useState, type ReactNode } from "react";
import { fetchProduct } from "../api.ts";
import type { ProductDetail } from "../types.ts";
import { formatDateTime, formatPrice } from "../format.ts";
import { Img } from "./Img.tsx";
import { BidBadge } from "./ProductTable.tsx";

/** Slide-over panel with every photo and spec for one product. */
export function ProductDrawer({ id, onClose }: { id: string; onClose: () => void }) {
    const [product, setProduct] = useState<ProductDetail | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [active, setActive] = useState(0);

    useEffect(() => {
        const controller = new AbortController();
        setProduct(null);
        setError(null);
        setActive(0);
        fetchProduct(id, controller.signal)
            .then(setProduct)
            .catch((err) => !controller.signal.aborted && setError(err.message));
        return () => controller.abort();
    }, [id]);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [onClose]);

    const image = product?.images[active] ?? null;

    return (
        <div className="fixed inset-0 z-40 flex justify-end">
            <div className="absolute inset-0 bg-stone-950/40" onClick={onClose} />
            <aside className="relative flex h-full w-full max-w-2xl flex-col overflow-y-auto bg-white shadow-2xl dark:bg-stone-900">
                <header className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-stone-200 bg-white/95 px-6 py-4 backdrop-blur dark:border-stone-800 dark:bg-stone-900/95">
                    <div className="min-w-0">
                        <h2 className="truncate text-lg font-semibold">{product?.name ?? (error ? "Error" : "Loading…")}</h2>
                        {product && (
                            <p className="text-sm text-stone-500 dark:text-stone-400">
                                {product.source.name} · #{product.externalId}
                                {product.category && ` · ${product.category}`}
                                {product.subcategory && ` › ${product.subcategory}`}
                            </p>
                        )}
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        aria-label="Close"
                        className="shrink-0 cursor-pointer rounded-md p-1.5 text-stone-500 hover:bg-stone-100 dark:hover:bg-stone-800"
                    >
                        <svg viewBox="0 0 20 20" className="h-5 w-5" fill="currentColor" aria-hidden>
                            <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
                        </svg>
                    </button>
                </header>

                {error && <p className="p-6 text-sm text-red-600">{error}</p>}

                {product && (
                    <div className="space-y-6 p-6">
                        {/* Gallery */}
                        <div>
                            <Img image={image} alt={product.name ?? ""} className="aspect-[4/3] w-full rounded-lg" />
                            {product.images.length > 1 && (
                                <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
                                    {product.images.map((img, i) => (
                                        <button
                                            key={img.remote}
                                            type="button"
                                            onClick={() => setActive(i)}
                                            className={`shrink-0 cursor-pointer overflow-hidden rounded-md ring-2 ${
                                                i === active ? "ring-chart" : "ring-transparent opacity-70 hover:opacity-100"
                                            }`}
                                        >
                                            <Img image={img} alt="" className="h-14 w-20" />
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>

                        {/* Price & auction */}
                        <div className="grid grid-cols-2 gap-4 rounded-lg bg-stone-50 p-4 sm:grid-cols-4 dark:bg-stone-800/50">
                            <Fact label="Price">
                                <span className="text-lg font-semibold">{formatPrice(product.price)}</span>
                                <div><BidBadge product={product} /></div>
                            </Fact>
                            <Fact label="Lot number">{product.currentBid?.lotNumber ?? product.externalId}</Fact>
                            <Fact label="Sale date">{formatDateTime(product.currentBid?.saleDate)}</Fact>
                            <Fact label="Sale name">{product.currentBid?.saleName ?? "—"}</Fact>
                            <Fact label="Auction status">{product.currentBid?.status ?? "—"}</Fact>
                            <Fact label="First seen">{formatDateTime(product.createdAt)}</Fact>
                            <Fact label="Last scraped">{formatDateTime(product.lastScrapedAt)}</Fact>
                            <Fact label="Photos">{product.images.length}</Fact>
                        </div>

                        {/* Specs */}
                        {product.specs.length > 0 && (
                            <div>
                                <h3 className="mb-2 text-sm font-semibold">Specifications</h3>
                                <dl className="divide-y divide-stone-100 rounded-lg border border-stone-200 text-sm dark:divide-stone-800 dark:border-stone-800">
                                    {product.specs.map((s) => (
                                        <div key={s.key} className="grid grid-cols-3 gap-4 px-4 py-2">
                                            <dt className="text-stone-500 dark:text-stone-400">{s.key}</dt>
                                            <dd className="col-span-2 break-words">{s.value}</dd>
                                        </div>
                                    ))}
                                </dl>
                            </div>
                        )}

                        <a
                            href={product.url}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1.5 rounded-lg bg-chart px-4 py-2 text-sm font-medium text-white hover:opacity-90"
                        >
                            Open on {product.source.name} ↗
                        </a>
                    </div>
                )}
            </aside>
        </div>
    );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
    return (
        <div>
            <div className="text-xs text-stone-500 dark:text-stone-400">{label}</div>
            <div className="mt-0.5 text-sm font-medium">{children}</div>
        </div>
    );
}
