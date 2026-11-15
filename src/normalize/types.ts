/**
 * The common shape every scraped website is converted into before it reaches
 * the database. Each site gets a `Normalizer` in this folder that maps its own
 * scraped JSON onto `NormalizedListing`; nothing downstream knows or cares
 * which site a listing came from, so every site lands in the same `products`
 * table — whether it sells vehicles, car parts, food or electronics.
 *
 * Most fields are nullable on purpose — sites expose different subsets, and a
 * null means "this site didn't give us that" rather than "it's empty".
 */

export interface NormalizedSource {
    /** Stable machine key, e.g. "copart". Becomes `source.slug`. */
    slug: string;
    /** Human label, e.g. "Copart". Becomes `source.name`. */
    name: string;
    /** Becomes `source.description`. */
    description?: string | null;
    /** Site home page. Becomes `source.url`. */
    url?: string | null;
    /** "auction" | "retail" | "classifieds" | "dealer". Becomes `source.type`. */
    type?: string | null;
}

/** The `products` row itself. */
export interface NormalizedProduct {
    url: string;
    name: string | null;
    brand: string | null;
    /**
     * Headline price in MAJOR units (dollars, not cents): the asking price on
     * retail sites, Buy It Now / live bid on auction sites.
     */
    price: number | null;
    partNumber: string | null;
    sku: string | null;
    description: string | null;
    rating: number | null;
}

export interface NormalizedBid {
    /** The auction site's lot number. Becomes `current_bid.lot_number`. */
    lotNumber: string | null;
    /** Amount in MAJOR units. */
    price: number | null;
    currency: string;
    bidNow: boolean;
    buyItNow: boolean;
    pureSale: boolean;
    auctions: boolean;
    /** Parsed auction date; null when the site gave none or a word like "Future". */
    saleDate: Date | null;
    /** Auction sale name, stored with the bid and retained as a spec for compatibility. */
    saleName: string | null;
}

export interface NormalizedImage {
    /** Canonical remote URL. Becomes `product_images.image_url`. */
    imageUrl: string;
    isPrimary: boolean;
    /** Where the crawler saved the file, if it downloaded it. */
    path: string | null;
    /** File size in bytes, if downloaded. */
    size: number | null;
}

/** One `spec` row: anything the site reports that isn't a `products` column. */
export interface NormalizedSpec {
    key: string;
    value: string;
}

export interface NormalizedListing {
    source: NormalizedSource;
    /** The site's own listing/product id — Copart lot number, ASIN, … */
    externalId: string;
    product: NormalizedProduct;
    /** Top-level category name, e.g. "Vehicles", "Electronics". */
    category: string | null;
    /** Name beneath the category, e.g. "Pickup Trucks", "Phones". */
    subcategory: string | null;
    /**
     * Auction data. Null when the site has no bidding concept OR this scrape
     * didn't read any — no `current_bid` row is written then, so a blank
     * re-scrape can never wipe a stored live bid.
     */
    currentBid: NormalizedBid | null;
    images: NormalizedImage[];
    specs: NormalizedSpec[];
    /** Original scraped payload, stored so listings can be re-normalized later. */
    raw?: unknown;
}

/**
 * Converts one site's scraped record into the common shape.
 *
 * To support a new website: implement this, then register it in
 * src/normalize/index.ts. No database code needs to change.
 */
export interface Normalizer<TRaw = unknown> {
    source: NormalizedSource;
    /**
     * Returns null when the record can't be identified as a listing (e.g. no
     * external id), so the caller can skip it instead of writing a junk row.
     */
    normalize(raw: TRaw): NormalizedListing | null;
}
