// Shapes returned by the API in src/server.ts.

export interface Stats {
    totals: {
        products: number;
        withBids: number;
        images: number;
        sources: number;
        avgPrice: number | null;
        minPrice: number | null;
        maxPrice: number | null;
    };
    lastScrapedAt: string | null;
    bySource: { slug: string; name: string; count: number }[];
    byCategory: { category: string | null; subcategories: number; count: number }[];
    perDay: { day: string; count: number }[];
}

export interface Filters {
    sources: { slug: string; name: string }[];
    categories: { name: string; subcategories: string[] }[];
}

export interface ImageRef {
    /** Local copy served by the API when downloaded, else the remote URL. */
    src: string;
    remote: string;
}

export interface CurrentBid {
    lotNumber: string | null;
    price: number | null;
    currency: string;
    bidNow: boolean;
    buyItNow: boolean;
    pureSale?: boolean;
    saleDate: string | null;
    saleName: string | null;
    status: string;
}

export interface ProductSummary {
    id: string;
    name: string | null;
    externalId: string;
    url: string;
    price: number | null;
    source: { slug: string; name: string };
    category: string | null;
    subcategory: string | null;
    lastScrapedAt: string;
    createdAt: string;
    image: ImageRef | null;
    imageCount: number;
    specs: Record<string, string>;
    currentBid: CurrentBid | null;
}

export interface ProductPage {
    page: number;
    pageSize: number;
    total: number;
    items: ProductSummary[];
}

export interface ProductDetail {
    id: string;
    name: string | null;
    brand: string | null;
    description: string | null;
    externalId: string;
    url: string;
    price: number | null;
    source: { slug: string; name: string; url: string | null };
    category: string | null;
    subcategory: string | null;
    createdAt: string;
    lastScrapedAt: string;
    images: (ImageRef & { isPrimary: boolean })[];
    specs: { key: string; value: string }[];
    currentBid: CurrentBid | null;
}

export interface ProductQuery {
    q: string;
    source: string;
    category: string;
    bid: "" | "buyItNow" | "bidNow";
    auctionStatus: "" | "live" | "ended";
    sort: "recent" | "oldest" | "price_desc" | "price_asc" | "name";
    page: number;
    pageSize: number;
}
