import type { ProductRecord } from "../types.js";
import type { NormalizedBid, Normalizer, NormalizedImage, NormalizedListing } from "./types.js";
import {
    int,
    keyValueListToObject,
    looksLikePrice,
    money,
    splitVehicleTitle,
    text,
    toSpecs,
} from "./helpers.js";

/**
 * Copart — maps the `ProductRecord` produced by src/main.ts onto the shared
 * `products` structure.
 *
 * Copart's detail data arrives as a flat `specs` list of label/value pairs, so
 * most vehicle attributes are read out by label here rather than in the
 * scraper. Whatever doesn't map onto a `products` column becomes a `spec` row.
 */

/**
 * Promoted into `current_bid` / `products.price`, so they'd be duplicates in
 * `spec`. Sale Date / Sale Name are re-added below from whichever place the
 * record carries them. "Lot Number" only appears in `specs` on records scraped
 * before it moved to `currentBid.lotNumber`.
 */
const SPEC_KEYS_HANDLED_ELSEWHERE = new Set([
    "Current Bid",
    "Buy It Now",
    "Lot Number",
    "Sale Date",
    "Sale Name",
]);

/**
 * `current_bid.sale_date` is a timestamp. Copart gives either epoch millis (API)
 * or text like "Mon. Oct 05, 2026 06:00 PM GMT" (page); anything else, such as
 * "Future", has no date yet.
 */
function parseSaleDate(value: string | null): Date | null {
    if (!value) return null;
    const date = /^\d{10,13}$/.test(value)
        ? new Date(Number(value.length === 10 ? `${value}000` : value))
        : new Date(value.replace(/^[A-Za-z]{3}\.?\s+/, ""));
    return Number.isNaN(date.getTime()) ? null : date;
}

/** Copart serves "..._ful.jpg" full size and "..._thb.jpg" thumbnails. */
function isFullSize(url: string): boolean {
    return /_ful\.[a-z]+(?:\?|$)/i.test(url);
}

function buildImages(record: ProductRecord): NormalizedImage[] {
    const seen = new Set<string>();
    const images = (record?.images ?? [])
        .filter((image) => {
            const url = text(image?.original);
            if (!url || seen.has(url)) return false;
            seen.add(url);
            return true;
        })
        .map((image) => ({
            imageUrl: image.original,
            isPrimary: false,
            path: text(image.path),
            size: Number.isFinite(image.size) ? image.size : null,
        }));

    // The first full-size photo is the listing's hero shot; fall back to the
    // first image of any kind so a product is never left without a primary.
    const primary = images.find((image) => isFullSize(image.imageUrl)) ?? images[0];
    if (primary) primary.isPrimary = true;

    return images;
}

export const copartNormalizer: Normalizer<ProductRecord> = {
    source: {
        slug: "copart",
        name: "Copart",
        description: "Online vehicle auctions (salvage, clean title, wholesale).",
        url: "https://www.copart.com",
        type: "auction",
    },

    normalize(record: ProductRecord): NormalizedListing | null {
        const specs = keyValueListToObject(record?.specs);

        // The lot number is Copart's listing id. Fall back to the URL when the
        // API came back empty, since /lot/<id>/ is always present.
        const externalId =
            text(record?.sourceId) ??
            text(record?.currentBid?.lotNumber) ??
            text(specs["Lot Number"]) ??
            text(record?.url?.match(/\/lot\/(\d+)/)?.[1]);

        if (!externalId) return null;

        const name = text(record?.name);
        // Year/make/model live only in `specs` now (see main.ts's buildSpecs),
        // not as their own product columns — read "Make" back out of there,
        // falling back to parsing the title if a site doesn't provide it.
        const fromTitle = splitVehicleTitle(name);
        const make = text(specs["Make"]) ?? fromTitle.make;

        const currentBidPrice = money(specs["Current Bid"]);
        const buyItNowPrice = money(specs["Buy It Now"]);
        // Headline price: a Buy It Now figure beats a live bid.
        const price =
            buyItNowPrice ??
            currentBidPrice ??
            money(record?.currentBid?.BuyitNowprice) ??
            money(record?.currentBid?.Bidprice);

        const saleDateText = text(record?.currentBid?.saleDate) ?? text(specs["Sale Date"]);
        const saleName = text(record?.currentBid?.saleName) ?? text(specs["Sale Name"]);
        const saleDate = parseSaleDate(saleDateText);

        // Only a scrape that actually read auction data counts here; a sale
        // name alone is useful data even when the date and prices are absent.
        const currentBid: NormalizedBid | null =
            price === null && saleDate === null && saleName === null
                ? null
                : {
                      lotNumber:
                          text(record?.currentBid?.lotNumber) ?? text(specs["Lot Number"]) ?? externalId,
                      price,
                      currency: "USD",
                      bidNow:
                          Boolean(record?.currentBid?.auctions) ||
                          looksLikePrice(specs["Current Bid"]) ||
                          looksLikePrice(record?.currentBid?.Bidprice) ||
                          Boolean(record?.currentBid?.bidNow),
                      buyItNow:
                          looksLikePrice(specs["Buy It Now"]) ||
                          looksLikePrice(record?.currentBid?.BuyitNowprice) ||
                          Boolean(record?.currentBid?.buyItNow),
                      pureSale: Boolean(record?.currentBid?.pureSale),
                      auctions: record?.currentBid?.auctions ?? true,
                      saleDate,
                      saleName,
                  };

        // Everything the site told us that isn't a `products` column, plus a
        // couple of parsed conveniences so callers don't re-parse strings.
        const specRows = toSpecs({
            ...Object.fromEntries(
                Object.entries(specs).filter(([key]) => !SPEC_KEYS_HANDLED_ELSEWHERE.has(key))
            ),
            // Keep the original display date even when it cannot be parsed.
            // Sale Name stays here too for compatibility with existing clients.
            "Sale Date": saleDateText,
            "Sale Name": saleName,
            "Odometer Miles": int(specs["Odometer"]),
            Trim: fromTitle.trim,
        });

        return {
            source: this.source,
            externalId,

            product: {
                url: record.url,
                name,
                // For a vehicle the brand is the make.
                brand: make,
                price,
                partNumber: null,
                sku: null,
                description: text(record?.description),
                rating: null,
            },

            category: text(record?.category) ?? "Vehicles",
            subcategory: text(record?.subcategory),

            currentBid,
            images: buildImages(record),
            specs: specRows,
            raw: record,
        };
    },
};
