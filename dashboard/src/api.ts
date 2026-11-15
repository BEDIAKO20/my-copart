import type { Filters, ProductDetail, ProductPage, ProductQuery, Stats } from "./types.ts";

async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
    const res = await fetch(path, { signal });
    if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `Request failed (${res.status})`);
    }
    return res.json() as Promise<T>;
}

export const fetchStats = (signal?: AbortSignal) => getJson<Stats>("/api/stats", signal);

export const fetchFilters = (signal?: AbortSignal) => getJson<Filters>("/api/filters", signal);

export function fetchProducts(query: ProductQuery, signal?: AbortSignal) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
        if (value !== "" && value !== undefined) params.set(key, String(value));
    }
    return getJson<ProductPage>(`/api/products?${params}`, signal);
}

export const fetchProduct = (id: string, signal?: AbortSignal) =>
    getJson<ProductDetail>(`/api/products/${encodeURIComponent(id)}`, signal);

export const deleteSourceProducts = (slug: string) =>
    fetch(`/api/sources/${encodeURIComponent(slug)}/products`, { method: "DELETE" }).then(async (res) => {
        if (!res.ok) {
            const body = await res.json().catch(() => null);
            throw new Error(body?.error ?? `Request failed (${res.status})`);
        }
        return res.json() as Promise<{ source: string; products: number; keptWithBids: number }>;
    });

export const deleteCategoryProducts = (name: string) =>
    fetch(`/api/categories/${encodeURIComponent(name)}/products`, { method: "DELETE" }).then(async (res) => {
        if (!res.ok) {
            const body = await res.json().catch(() => null);
            throw new Error(body?.error ?? `Request failed (${res.status})`);
        }
        return res.json() as Promise<{ products: number; keptWithBids: number }>;
    });

export const deleteProduct = (id: string) =>
    fetch(`/api/products/${encodeURIComponent(id)}`, { method: "DELETE" }).then(async (res) => {
        if (!res.ok) {
            const body = await res.json().catch(() => null);
            throw new Error(body?.error ?? `Request failed (${res.status})`);
        }
        return res.json() as Promise<{ products: number; keptWithBids: number }>;
    });
