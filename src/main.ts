import { PlaywrightCrawler, Dataset, sleep, log } from "crawlee";
import type { Page } from "playwright";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import path from "node:path";
import { disconnectPrisma, isDbConfigured } from "./db/prisma.js";
import { assertDatabaseReady } from "./db/preflight.js";
import { saveScraped } from "./db/listings.js";
import { clearSourceProducts } from "./db/clear.js";
import { SCRAPE_JOBS, type ScrapeJob } from "./jobs.js";
import type { CurrentBid, ImageAsset, ProductRecord, RawLot } from "./types.js";

// ─── Configuration ────────────────────────────────────────────────────────────
const MAX_PAGES_PER_QUERY = 5;
const HEADLESS = false; // Set true after confirming it works
const CHROME_EXECUTABLE_PATH = [
    process.env["ProgramFiles(x86)"]
        ? path.join(process.env["ProgramFiles(x86)"], "Google", "Chrome", "Application", "chrome.exe")
        : undefined,
    process.env.ProgramFiles
        ? path.join(process.env.ProgramFiles, "Google", "Chrome", "Application", "chrome.exe")
        : undefined,
    process.env.LOCALAPPDATA
        ? path.join(process.env.LOCALAPPDATA, "Google", "Chrome", "Application", "chrome.exe")
        : undefined,
].find((candidate): candidate is string => candidate !== undefined && existsSync(candidate));

const SOURCE = "Copart";
// Key of the normalizer that converts this scraper's output into the shared
// `products` structure — see src/normalize/copart.ts.
const SOURCE_SLUG = "copart";

// Where downloaded images are written to disk, and the base URL used to build
// each image's "httpUrl" (point this at whatever serves the storage/ folder).
const IMAGES_DIR = "storage/images";
const IMAGE_BASE_URL = "http://localhost:3000";

// Set DATABASE_URL in .env to also write every lot into Neon Postgres as it is
// scraped. Without it the crawler just writes local JSON, exactly as before.
const DB_ENABLED = isDbConfigured();

// Counters so a run can never finish quietly with an empty database.
let dbSaved = 0;
let dbFailed = 0;
// ──────────────────────────────────────────────────────────────────────────────

// ─── Active API fetch (runs inside browser, uses its session/cookies) ─────────

async function fetchCopartApi(page: Page, apiUrl: string): Promise<Record<string, any> | null> {
    return page.evaluate(async (url) => {
        try {
            const res = await fetch(url, {
                headers: {
                    "Accept": "application/json, text/plain, */*",
                    "Accept-Language": "en-US,en;q=0.9",
                },
                credentials: "include",
            });
            if (!res.ok) return null;
            return await res.json();
        } catch {
            return null;
        }
    }, apiUrl);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function safeText(page: Page, selector: string): Promise<string> {
    return page.$eval(selector, (el) => el.textContent?.trim() ?? "").catch(() => "");
}

async function extractAuctionInput(page: Page, name: string, id: string): Promise<string> {
    return page
        .$eval(
            `#${id}, input[name="${name}"]`,
            (element) => {
                const input = element as HTMLInputElement;
                return input.value.trim() || input.placeholder.trim() || input.getAttribute("aria-valuenow")?.trim() || "";
            }
        )
        .catch(() => "");
}

async function extractAuctionPrice(page: Page, labels: string[]): Promise<string> {
    return page.evaluate((wantedLabels) => {
        const labels = wantedLabels.map((label) => label.toLowerCase());
        const amountPattern = /\$?\s*[\d,]+(?:\.\d+)?/;
        const candidates: { amount: string; size: number }[] = [];

        for (const element of Array.from(document.querySelectorAll("button, span, div, p, label"))) {
            const text = (element.textContent ?? "").replace(/\s+/g, " ").trim();
            const lower = text.toLowerCase();
            if (!labels.some((label) => lower.includes(label))) continue;
            const match = text.match(amountPattern);
            if (match) candidates.push({ amount: match[0].replace(/\s+/g, ""), size: text.length });
        }

        candidates.sort((a, b) => a.size - b.size);
        return candidates[0]?.amount ?? "";
    }, labels);
}

async function extractByLabel(page: Page, label: string): Promise<string> {
    return page.evaluate((labelText) => {
        const wanted = labelText.replace(/\s+/g, " ").replace(/:\s*$/, "").trim().toLowerCase();
        const amountPattern = /\$[\d,]+(?:\.\d+)?/;
        const candidates: { text: string; size: number }[] = [];

        for (const row of Array.from(document.querySelectorAll(".lot-details-information"))) {
            const rowLabel = row.querySelector(".lot-details-information-label")?.textContent ?? "";
            if (rowLabel.replace(/\s+/g, " ").replace(/:\s*$/, "").trim().toLowerCase() !== wanted) continue;

            const valueElement = row.querySelector(".lot-details-information-value");
            if (!valueElement) continue;
            const value = valueElement.cloneNode(true) as HTMLElement;
            value.querySelectorAll("button, .calendar-trigger-wrapper, p-overlay").forEach((child) => child.remove());
            const valueText = (value.textContent ?? "").replace(/\s+/g, " ").trim();
            if (valueText && !/^on$/i.test(valueText)) return valueText;
        }

        for (const el of Array.from(document.querySelectorAll("td, th, dt, li, span, div, p, label"))) {
            const text = (el.textContent ?? "").replace(/\s+/g, " ").trim();
            if (text.replace(/:\s*$/, "").toLowerCase() !== wanted) continue;

            const sibling = el.nextElementSibling;
            if (sibling) {
                const value = sibling.cloneNode(true) as HTMLElement;
                value.querySelectorAll("button, .calendar-trigger-wrapper, p-overlay").forEach((child) => child.remove());
                const siblingText = (value.textContent ?? "").replace(/\s+/g, " ").trim();
                if (siblingText && !/^on$/i.test(siblingText)) {
                    candidates.push({ text: siblingText, size: siblingText.length });
                }
            }

            if (amountPattern.test(text)) candidates.push({ text, size: text.length });

            const input = el.querySelector("input");
            if (input) {
                const inputValue =
                    input.value?.trim() ||
                    input.getAttribute("placeholder")?.trim() ||
                    input.getAttribute("aria-valuenow")?.trim() ||
                    "";
                if (inputValue) candidates.push({ text: inputValue, size: inputValue.length });
            }
        }

        candidates.sort((a, b) => a.size - b.size);
        const result = candidates[0]?.text.match(amountPattern)?.[0] ?? candidates[0]?.text ?? "";
        return /^on$/i.test(result) ? "" : result;
    }, label);
}

// ─── Image downloading ────────────────────────────────────────────────────────

const IMAGE_EXT_RE = /\.(jpe?g|png|gif|webp)(?:\?|$)/i;

function filenameFromUrl(url: string): string {
    const withoutQuery = url.split("?")[0];
    return path.basename(withoutQuery);
}

async function downloadImages(urls: string[], lotNumber: string): Promise<ImageAsset[]> {
    const imageUrls = urls.filter((u) => IMAGE_EXT_RE.test(u));
    if (imageUrls.length === 0) return [];

    const destDir = path.join(IMAGES_DIR, lotNumber);
    await mkdir(destDir, { recursive: true });

    const assets: ImageAsset[] = [];
    for (const original of imageUrls) {
        const filename = filenameFromUrl(original);
        const relativePath = path.join(destDir, filename).replace(/\\/g, "/");

        try {
            const res = await fetch(original);
            if (!res.ok) {
                log.warning(`  Image download failed (${res.status}): ${original}`);
                continue;
            }
            const buffer = Buffer.from(await res.arrayBuffer());
            await writeFile(path.join(destDir, filename), buffer);

            assets.push({
                original,
                path: relativePath,
                httpUrl: `${IMAGE_BASE_URL}/${relativePath}`,
                size: buffer.byteLength,
            });
        } catch (err) {
            log.warning(`  Image download error for ${original}: ${(err as Error).message}`);
        }
    }
    return assets;
}

// ─── Recovering fields Copart merges together ─────────────────────────────────
//
// Copart occasionally returns one field's value as several OTHER fields
// concatenated with no separator — seen live, a lot's titleCode came back as:
//   "NE - Cert Of Title-salvage Odometer:190,378 mi  Actual Primary damage:Hail
//    Estimated retail value:$17,431.00USD Cylinders:6 Color:White Has key:Yes
//    Engine type:3.5L 6 Transmission:Automatic ... Notes:There are no notes
//    for this lot Order condition report"
// Some fields (estimated value, has keys, driveability) are almost always
// blank when read directly, but turn up embedded in a blob like this one when
// Copart happens to produce it. This pulls them out instead of discarding them,
// and trims the polluted field back down to just its own real value.

/**
 * Canonical label (as it appears in a blob) -> the RawLot field it belongs to.
 * A few labels Copart includes (cylinders, vehicle type) have no matching
 * RawLot field — they're kept here as `null` anyway so the blob splitter still
 * treats them as a boundary; without that the value ahead of them (e.g.
 * "Estimated retail value") would swallow them as trailing garbage.
 */
const LABEL_TO_FIELD: Record<string, keyof RawLot | null> = {
    "title code": "titleCode",
    "odometer": "odometer",
    "primary damage": "primaryDamage",
    "secondary damage": "secondaryDamage",
    "estimated retail value": "estimatedValue",
    "cylinders": null,
    "color": "color",
    "has key": "keys",
    "has keys": "keys",
    "engine type": "engine",
    "transmission": "transmission",
    "vehicle type": null,
    "drivetrain": "drivetrain",
    "fuel": "fuel",
    "body style": "bodyStyle",
    "sale date": "saleDate",
    "highlights": "highlights",
    "notes": "notes",
    "driveability": "driveability",
};

const BLOB_LABEL_PATTERN = new RegExp(
    `(${Object.keys(LABEL_TO_FIELD)
        .sort((a, b) => b.length - a.length)
        .map((l) => l.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
        .join("|")})\\s*:`,
    "gi"
);

/**
 * Splits a value on embedded "Label:" markers. Returns the field's own clean
 * value (the text before the first embedded label) plus whatever other fields
 * were recovered from the rest. A value with fewer than two markers isn't
 * treated as a blob — that's just normal text that happens to contain a colon.
 */
function recoverBlob(value: string): { clean: string; recovered: Partial<Record<keyof RawLot, string>> } {
    const matches = [...value.matchAll(BLOB_LABEL_PATTERN)];
    if (matches.length < 2) return { clean: value, recovered: {} };

    const clean = value.slice(0, matches[0].index).trim();
    const recovered: Partial<Record<keyof RawLot, string>> = {};
    for (let i = 0; i < matches.length; i++) {
        const field = LABEL_TO_FIELD[matches[i][1].toLowerCase()];
        if (!field) continue;
        const start = matches[i].index! + matches[i][0].length;
        const end = i + 1 < matches.length ? matches[i + 1].index! : value.length;
        const segment = value.slice(start, end).trim();
        if (segment) recovered[field] = segment;
    }
    return { clean, recovered };
}

/**
 * Runs every string field of `lot` through recoverBlob(), filling in any
 * currently-blank field from whatever got recovered and replacing a polluted
 * field with its own clean value. Mutates and returns `lot`.
 */
function recoverBlobFields(lot: RawLot): RawLot {
    for (const field of Object.keys(lot) as (keyof RawLot)[]) {
        const value = lot[field];
        if (typeof value !== "string" || value.length < 40) continue;
        const { clean, recovered } = recoverBlob(value);
        if (Object.keys(recovered).length === 0) continue;
        (lot as any)[field] = clean;
        for (const [key, val] of Object.entries(recovered) as [keyof RawLot, string][]) {
            if (!lot[key]) (lot as any)[key] = val;
        }
    }
    return lot;
}

// Copart sometimes appends extra lot metadata straight onto the VIN with no
// separator: "1FTEW1EG0HF******Lot number:63387556Lane/Item:     C/3036".
function cleanVin(value: string): string {
    return value.split(/Lot number:|Lane\/Item:/i)[0].trim();
}

/** Whatever phrasing Copart used for "does it have keys" -> a clean Yes/No. */
function normalizeYesNo(value: string): string {
    const v = value.trim().toLowerCase();
    if (!v) return "";
    if (/^(y|yes|true|1)$/.test(v) || /\byes\b/.test(v)) return "Yes";
    if (/^(n|no|false|0)$/.test(v) || /\bno\b/.test(v)) return "No";
    // Unrecognized phrasing — pass it through rather than guessing wrong.
    return value.trim();
}

// ─── Output shaping ───────────────────────────────────────────────────────────

// A raw currentBid/buyItNow value only counts as a real price if it contains a
// digit — Copart's page/API sometimes echoes back the field's own label
// (e.g. literally "Current bid") as a placeholder when bidding hasn't started.
function looksLikePrice(v: string): boolean {
    return /\d/.test(v);
}

// Formats a raw scraped amount (e.g. "6700", "$6,700.00") as "$6,700"
function formatPrice(raw: string): string {
    const match = raw.replace(/,/g, "").match(/\d+(\.\d+)?/);
    if (!match) return "";
    const amount = parseFloat(match[0]);
    return amount === 0 ? "$0.00" : `$${Math.round(amount).toLocaleString("en-US")}`;
}

function buildCurrentBid(raw: RawLot): CurrentBid {
    const hasBuyItNow = looksLikePrice(raw.buyItNow);
    const saleDate = /^on$/i.test(raw.saleDate.trim()) ? "" : raw.saleDate;
    const saleName = /^on$/i.test(raw.saleName.trim()) ? "" : raw.saleName;

    return {
        lotNumber: raw.lotNumber,
        Bidprice: formatPrice(raw.currentBid) || "$0.00",
        BuyitNowprice: formatPrice(raw.buyItNow) || "$0.00",
        Startingbid: formatPrice(raw.startingBid) || "$0.00",
        Maximumbid: formatPrice(raw.maximumBid) || "$0.00",
        bidNow: true,
        buyItNow: hasBuyItNow,
        pureSale: false,
        auctions: true,
        saleDate,
        saleName,
    };
}

// Every entry becomes a row in the `spec` table, keyed by (product_id, key).
// Blank values are dropped by the normalizer, so listing a field the site
// didn't provide costs nothing.
function buildSpecs(raw: RawLot): { key: string; value: string }[] {
    return [
        { key: "Year", value: raw.year },
        { key: "Make", value: raw.make },
        { key: "Model", value: raw.model },
        { key: "Current Bid", value: raw.currentBid },
        { key: "Buy It Now", value: raw.buyItNow },
        { key: "Primary Damage", value: raw.primaryDamage },
        { key: "Secondary Damage", value: raw.secondaryDamage },
        { key: "Odometer", value: raw.odometer },
        { key: "VIN", value: raw.vin },
        { key: "Body Style", value: raw.bodyStyle },
        { key: "Engine", value: raw.engine },
        { key: "Transmission", value: raw.transmission },
        { key: "Drivetrain", value: raw.drivetrain },
        { key: "Fuel", value: raw.fuel },
        { key: "Color", value: raw.color },
        { key: "Location", value: raw.location },
        { key: "Title Code", value: raw.titleCode },
        { key: "Est. Retail Value", value: raw.estimatedValue },
        { key: "Has Keys", value: normalizeYesNo(raw.keys) },
        { key: "Driveability", value: raw.driveability },
        { key: "Highlights", value: raw.highlights },
        { key: "Notes", value: raw.notes },
    ];
}

async function toProductRecord(raw: RawLot, job: ScrapeJob): Promise<ProductRecord> {
    const images = await downloadImages(raw.images, raw.lotNumber);

    return {
        url: raw.url,
        name: raw.title,
        currentBid: buildCurrentBid(raw),
        category: job.CATEGORY,
        subcategory: job.SUBCATEGORY,
        description: "",
        specs: buildSpecs(raw),
        images,
        source: SOURCE,
        sourceId: raw.lotNumber,
    };
}

// ─── Page Handlers ────────────────────────────────────────────────────────────

async function handleSearchResults(page: Page, enqueueLinks: Function, requestUrl: string, job: ScrapeJob) {
    log.info(`Scraping search results: ${requestUrl}`);

    // Copart is an Angular SPA — wait for lot cards to render
    try {
        await page.waitForSelector('a[href*="/lot/"]', { timeout: 45_000 });
    } catch {
        const title = await page.title();
        const body = await safeText(page, "body");
        const message =
            `No Copart lot links appeared after 45s for ${requestUrl}. ` +
            `Page title: "${title}". Page text: ${body.slice(0, 500)}`;
        log.warning(message);
        throw new Error(message);
    }

    // Extra buffer for lazy-loaded cards
    await sleep(2_000);

    const lotUrls: string[] = await page.$$eval('a[href*="/lot/"]', (anchors) => {
        const seen = new Set<string>();
        return anchors
            .map((a) => (a as HTMLAnchorElement).href)
            .filter((href) => {
                if (seen.has(href)) return false;
                seen.add(href);
                return true;
            });
    });

    log.info(`Found ${lotUrls.length} lots on this page`);
    if (lotUrls.length === 0) {
        throw new Error(`Copart rendered lot links but none could be extracted from ${requestUrl}`);
    }
    await enqueueLinks({ urls: lotUrls, label: "DETAIL", userData: { job } });

    // Copart paginates with &index= (0-based page number)
    const indexMatch = requestUrl.match(/[?&]index=(\d+)/);
    const currentIndex = indexMatch ? parseInt(indexMatch[1], 10) : 0;
    if (lotUrls.length > 0 && currentIndex < MAX_PAGES_PER_QUERY - 1) {
        const nextUrl = indexMatch
            ? requestUrl.replace(/([?&]index=)\d+/, `$1${currentIndex + 1}`)
            : `${requestUrl}&index=${currentIndex + 1}`;
        log.info(`Enqueueing next page: ${nextUrl}`);
        await enqueueLinks({ urls: [nextUrl], label: "SEARCH", userData: { job } });
    }
}

async function handleLotDetail(page: Page, url: string, job: ScrapeJob) {
    log.info(`Scraping lot detail: ${url}`);

    const lotMatch = url.match(/\/lot\/(\d+)/);
    const lotNumber = lotMatch ? lotMatch[1] : "";

    // Wait for Angular app to bootstrap (any meaningful element)
    try {
        await page.waitForFunction(
            () => document.title.length > 5 && !document.title.toLowerCase().includes("loading"),
            { timeout: 30_000 }
        );
    } catch {
        log.warning(`Page title never resolved for: ${url}`);
    }

    // Extra buffer for XHR/fetch calls to complete
    await sleep(4_000);

    // ── Actively call Copart's REST API from inside the browser ──────────────
    log.info(`  Fetching lot API for lot ${lotNumber}...`);
    const lotApiData = await fetchCopartApi(
        page,
        `https://api.copart.com/public/lots/${lotNumber}`
    );

    log.info(`  Fetching image API for lot ${lotNumber}...`);
    const lotImageData = await fetchCopartApi(
        page,
        `https://api.copart.com/public/lots/images/${lotNumber}`
    );

    log.info(`  API data: ${lotApiData ? "OK" : "FAILED"} | Image data: ${lotImageData ? "OK" : "FAILED"}`);

    // Log raw API data to help debug field names
    if (lotApiData) {
        const preview = JSON.stringify(lotApiData).substring(0, 400);
        log.debug(`  Raw lot API: ${preview}`);
    }
    if (lotImageData) {
        const preview = JSON.stringify(lotImageData).substring(0, 400);
        log.debug(`  Raw image API: ${preview}`);
    }

    // Set DEBUG_RAW_API=1 to dump the FULL (untruncated) response to disk —
    // the 400-char preview above is nowhere near enough to spot a field Copart
    // renamed. Off by default so normal runs don't fill storage/debug/.
    if (process.env.DEBUG_RAW_API) {
        await mkdir("storage/debug", { recursive: true }).catch(() => {});
        if (lotApiData) {
            await writeFile(`storage/debug/${lotNumber}-lot.json`, JSON.stringify(lotApiData, null, 2)).catch(() => {});
        }
        if (lotImageData) {
            await writeFile(`storage/debug/${lotNumber}-images.json`, JSON.stringify(lotImageData, null, 2)).catch(() => {});
        }
    }

    let lot: RawLot;

    if (lotApiData) {
        // Copart may wrap the payload: { data: { ... } } or { returnCode: 1, data: { ... } }
        const d: Record<string, any> =
            (lotApiData as any).data?.lot ??
            (lotApiData as any).data ??
            lotApiData;

        const get = (...keys: string[]): string => {
            for (const k of keys) {
                const v = d[k];
                if (v !== undefined && v !== null && String(v).trim() !== "") {
                    return String(v).trim();
                }
            }

            const wanted = new Set(keys.map((key) => key.toLowerCase()));
            const visit = (value: unknown): string => {
                if (!value || typeof value !== "object") return "";
                for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
                    if (wanted.has(key.toLowerCase()) && nested !== null && nested !== undefined) {
                        const result = String(nested).trim();
                        if (result) return result;
                    }
                    const result = visit(nested);
                    if (result) return result;
                }
                return "";
            };
            return visit(d);
        };

        const titleParts = [get("y", "year"), get("mk", "make"), get("m", "model")].filter(Boolean);
        const title = titleParts.length
            ? titleParts.join(" ")
            : get("ld", "title", "description");

        // Extract full-size images
        const images: string[] = [];
        if (lotImageData) {
            const imgRoot =
                (lotImageData as any).data ??
                lotImageData;
            const fullImgs =
                imgRoot?.imageList?.FULL_IMAGE ??
                imgRoot?.imageList?.HIGH_RESOLUTION_IMAGE ??
                imgRoot?.imageList?.THUMBNAIL_IMAGE ??
                imgRoot?.images ??
                [];
            if (Array.isArray(fullImgs)) images.push(...fullImgs.map(String));
        }

        lot = {
            lotNumber:       get("ln", "lotNumber", "lotNumberStr") || lotNumber,
            year:            get("y", "year"),
            make:            get("mk", "make"),
            model:           get("m", "model"),
            title,
            titleCode:       get("tc", "titleCode", "titleType"),
            saleName:        get("sn", "saleName", "auctionName", "sale_name"),
            primaryDamage:   get("dd", "primaryDamage", "damage"),
            secondaryDamage: get("sdd", "secondaryDamage"),
            odometer:        [get("orr", "odometer"), get("ord", "odometerBrand")].filter(Boolean).join(" "),
            estimatedValue:  get("la", "estimatedRetailValue", "acv", "retailValue"),
            buyItNow:        get("bin", "buyItNow", "buyNow", "buyItNowPrice"),
            currentBid:      get("lcy", "currentBid", "bidPrice", "currentBidPrice"),
            startingBid:     get(
                "startingBid",
                "startingBidPrice",
                "startingBidAmount",
                "minimumBid",
                "minimumBidAmount",
                "minBid"
            ),
            maximumBid:      get(
                "maximumBid",
                "maximumBidPrice",
                "maximumBidAmount",
                "maxBid",
                "maxBidAmount",
                "maxProxyBid"
            ),
            saleDate:        get("ad", "saleDate", "auctionDate", "saleDateTime"),
            location:        get("yn", "yardName", "location", "yard"),
            vin:             get("fv", "vin", "vehicleIdentificationNumber"),
            color:           get("clr", "color"),
            bodyStyle:       get("bstl", "bodyStyle"),
            engine:          get("egn", "engine", "engineType"),
            transmission:    get("tsmv", "transmission", "trans"),
            drivetrain:      get("drv", "dr", "drivetrain", "driveType", "driveTrain"),
            fuel:            get("ft", "fuelType", "fuel"),
            keys:            get("hk", "hasKeys", "keys"),
            driveability:    get("driveability", "driveabilityRating"),
            highlights:      get("hlt", "highlights"),
            notes:           get("ln2", "notes", "lotNotes", "specialNotes"),
            images,
            url,
        };

        // Recover any fields Copart merged into one blob (see recoverBlobFields).
        recoverBlobFields(lot);
        lot.vin = cleanVin(lot.vin);

        // The public API is known to leave these blank on most lots even
        // though the rendered page shows them — take a second, DOM-based pass
        // at just the ones still missing rather than accepting "not scraped".
        const SUPPLEMENTARY_FIELDS: [keyof RawLot, string][] = [
            ["estimatedValue", "Est. Retail Value"],
            ["keys", "Has Keys"],
            ["driveability", "Driveability"],
            ["secondaryDamage", "Secondary Damage"],
        ];
        for (const [field, label] of SUPPLEMENTARY_FIELDS) {
            if (lot[field]) continue;
            const domValue = await extractByLabel(page, label);
            if (!domValue) continue;
            const { clean, recovered } = recoverBlob(domValue);
            if (clean) (lot as any)[field] = clean;
            for (const [key, val] of Object.entries(recovered) as [keyof RawLot, string][]) {
                if (!lot[key]) (lot as any)[key] = val;
            }
        }
        for (const [field, label] of [
            ["currentBid", "Current Bid"],
            ["startingBid", "Starting bid"],
            ["maximumBid", "Maximum bid"],
            ["buyItNow", "Buy it now"],
        ] as [keyof RawLot, string][]) {
            if (typeof lot[field] === "string" && lot[field] && !/^on$/i.test(lot[field])) continue;
            const value = await extractByLabel(page, label);
            if (value) (lot as any)[field] = value;
        }
        for (const field of ["saleDate", "saleName"] as const) {
            const value = await extractByLabel(page, field === "saleDate" ? "Sale Date" : "Sale Name");
            if (value) lot[field] = value;
        }
        if (!lot.startingBid) {
            lot.startingBid = await extractAuctionInput(page, "startingBid", "starting-bid-input");
        }
        if (!lot.maximumBid) {
            lot.maximumBid = await extractAuctionInput(page, "maximumBid", "maximum-bid-input");
        }
        const domBidPrice = await extractAuctionPrice(page, ["current bid"]);
        const domBuyItNowPrice = await extractAuctionPrice(page, ["buy it now", "buy now"]);
        if (domBidPrice) lot.currentBid = domBidPrice;
        if (domBuyItNowPrice) lot.buyItNow = domBuyItNowPrice;
    } else {
        // DOM fallback
        log.warning(`API failed for lot ${lotNumber} — falling back to DOM scraping`);

        const title = await safeText(page, "h1");
        const currentBid = await extractByLabel(page, "Current Bid");

        const images = await page.$$eval(
            'img[src*="copart.com"], img[src*="cs.copart"]',
            (imgs) => [...new Set((imgs as HTMLImageElement[]).map((i) => i.src).filter(Boolean))]
        ).catch(() => [] as string[]);

        // Parse year, make, model out of the title (e.g. "2017 FORD F150 SUPERCREW")
        const titleMatch = title.match(/^(\d{4})\s+(\S+)\s+(\S+)/);
        const year  = titleMatch ? titleMatch[1] : "";
        const make  = titleMatch ? titleMatch[2] : "";
        const model = titleMatch ? titleMatch[3] : "";

        lot = {
            lotNumber, year, make, model, title, currentBid,
            titleCode: "", saleName: "", primaryDamage: "", secondaryDamage: "",
            odometer: "", estimatedValue: "", buyItNow: "", startingBid: "", maximumBid: "", saleDate: "",
            location: "", vin: "", color: "", bodyStyle: "", engine: "",
            transmission: "", drivetrain: "", fuel: "", keys: "",
            driveability: "", highlights: "", notes: "", images, url,
        };

        for (const [key, label] of [
            ["titleCode",       "Title Code"],
            ["saleName",        "Sale Name"],
            ["primaryDamage",   "Primary Damage"],
            ["secondaryDamage", "Secondary Damage"],
            ["odometer",        "Odometer"],
            ["estimatedValue",  "Est. Retail Value"],
            ["buyItNow",        "Buy It Now"],
            ["startingBid",     "Starting bid"],
            ["maximumBid",      "Maximum bid"],
            ["saleDate",        "Sale Date"],
            ["location",        "Location"],
            ["vin",             "VIN"],
            ["color",           "Color"],
            ["bodyStyle",       "Body Style"],
            ["engine",          "Engine Type"],
            ["transmission",    "Transmission"],
            ["drivetrain",      "Drivetrain"],
            ["fuel",            "Fuel"],
            ["keys",            "Has Keys"],
            ["driveability",    "Driveability"],
            ["highlights",      "Highlights"],
            ["notes",           "Notes"],
        ] as [keyof RawLot, string][]) {
            const domValue = await extractByLabel(page, label);
            const { clean, recovered } = recoverBlob(domValue);
            (lot as any)[key] = clean;
            for (const [rk, rv] of Object.entries(recovered) as [keyof RawLot, string][]) {
                if (!lot[rk]) (lot as any)[rk] = rv;
            }
        }
        if (!lot.startingBid) {
            lot.startingBid = await extractAuctionInput(page, "startingBid", "starting-bid-input");
        }
        if (!lot.maximumBid) {
            lot.maximumBid = await extractAuctionInput(page, "maximumBid", "maximum-bid-input");
        }
        const domBidPrice = await extractAuctionPrice(page, ["current bid"]);
        const domBuyItNowPrice = await extractAuctionPrice(page, ["buy it now", "buy now"]);
        if (domBidPrice) lot.currentBid = domBidPrice;
        if (domBuyItNowPrice) lot.buyItNow = domBuyItNowPrice;
        lot.vin = cleanVin(lot.vin);
    }

    const record = await toProductRecord(lot, job);

    const bidLabel = record.currentBid.buyItNow ? "Buy It Now" : record.currentBid.bidNow ? "Current Bid" : "Price";
    log.info(
        `  ✓ Saved lot ${lot.lotNumber}: "${lot.title}" | ${bidLabel}: ` +
            `${record.currentBid.buyItNow ? record.currentBid.BuyitNowprice : record.currentBid.Bidprice} | ` +
            `Sale date: ${record.currentBid.saleDate || "N/A"} | ` +
            `Sale name: ${record.currentBid.saleName || "N/A"} | Images: ${record.images.length}`
    );
    await Dataset.pushData(record);

    // A database hiccup shouldn't abort the crawl — the record is already on
    // disk and `npm run db:import` can replay it later.
    if (DB_ENABLED) {
        try {
            const result = await saveScraped(SOURCE_SLUG, record);
            if (result) {
                dbSaved++;
                log.info(
                    `  ↳ Neon ${result.inserted ? "INSERTED" : "UPDATED"} products.id=${result.productId} ` +
                        `(${result.imageCount} image(s), ${result.specCount} spec(s)` +
                        `${result.bidWritten ? ", bid written" : ", bid unchanged"})`
                );
            } else {
                dbFailed++;
                log.warning(`  ↳ Neon skipped lot ${lot.lotNumber}: could not be normalized`);
            }
        } catch (err) {
            dbFailed++;
            log.error(`  ↳ Neon write failed for lot ${lot.lotNumber}: ${(err as Error).message}`);
        }
    }
}

// ─── Crawler Setup ────────────────────────────────────────────────────────────

const crawler = new PlaywrightCrawler({
    launchContext: {
        launchOptions: {
            headless: HEADLESS,
            executablePath: CHROME_EXECUTABLE_PATH,
            args: [
                "--no-sandbox",
                "--disable-setuid-sandbox",
                "--disable-blink-features=AutomationControlled",
            ],
        },
    },

    maxConcurrency: 1,
    navigationTimeoutSecs: 60,
    requestHandlerTimeoutSecs: 180,

    preNavigationHooks: [
        async ({ page }) => {
            // Only block fonts — keep everything else so API calls go through
            await page.route("**/*.{woff,woff2,ttf,eot}", (route) => route.abort());

            await page.setExtraHTTPHeaders({
                "Accept-Language": "en-US,en;q=0.9",
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "sec-ch-ua": '"Not_A Brand";v="8", "Chromium";v="120"',
                "sec-ch-ua-mobile": "?0",
                "sec-ch-ua-platform": '"Windows"',
            });
        },
    ],

    requestHandler: async ({ page, request, enqueueLinks }) => {
        await sleep(1500 + Math.random() * 2000);
        const job = request.userData.job as ScrapeJob;

        if (request.label === "DETAIL") {
            await handleLotDetail(page, request.url, job);
        } else {
            await handleSearchResults(page, enqueueLinks, request.url, job);
        }
    },

    failedRequestHandler: async ({ request }) => {
        log.error(`Request failed: ${request.url}`);
    },
});

// ─── Run ──────────────────────────────────────────────────────────────────────

/**
 * Decides whether to wipe the old Copart data before crawling:
 *   npm start -- --clear   wipe without asking
 *   npm start -- --keep    keep existing data without asking
 *   npm start              ask (y/N); keeps the data when there is no terminal to ask
 */
async function shouldClearOldData(): Promise<boolean> {
    const args = process.argv.slice(2);
    if (args.includes("--clear")) return true;
    if (args.includes("--keep")) return false;
    if (!process.stdin.isTTY) return false;

    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try {
        const answer = await rl.question(`Clear the old ${SOURCE} data in the database before crawling? (y/N) `);
        return /^y(es)?$/i.test(answer.trim());
    } finally {
        rl.close();
    }
}

const startUrls = SCRAPE_JOBS.map((job) => ({
    url: job.SEARCH_URL,
    label: "SEARCH",
    userData: { job },
}));

log.info(`Starting Copart scraper — ${startUrls.length} URL(s)`);

// Fail before crawling, not after. Crawlee purges local storage at the start of
// a run, so a crawl whose database writes all fail loses the data completely.
if (DB_ENABLED) {
    try {
        const info = await assertDatabaseReady();
        log.info(`Neon Postgres: ready — ${info.database} on ${info.host} (schema ${info.schema})`);
    } catch (err) {
        log.error(`Neon Postgres is NOT usable, aborting before the crawl:\n${(err as Error).message}`);
        log.error("To crawl to local JSON only, comment out DATABASE_URL in .env.");
        await disconnectPrisma();
        process.exit(1);
    }

    // Optionally start from a clean slate: wipe ONLY the old "source": "Copart"
    // data. Every other source's rows stay exactly as they are. When kept,
    // existing lots are simply updated in place as they are re-scraped.
    if (await shouldClearOldData()) {
        try {
            const cleared = await clearSourceProducts(SOURCE_SLUG, SOURCE);
            log.info(
                `Neon Postgres: cleared old ${SOURCE} data — ${cleared.products} product(s), ` +
                    `${cleared.images} image(s), ${cleared.bids} bid(s), ${cleared.specs} spec(s).`
            );
            if (cleared.keptWithBids > 0) {
                log.info(`Neon Postgres: kept ${cleared.keptWithBids} ${SOURCE} product(s) that customers have bid on.`);
            }
        } catch (err) {
            log.error(`Could not clear old ${SOURCE} data, aborting before the crawl:\n${(err as Error).message}`);
            await disconnectPrisma();
            process.exit(1);
        }
    } else {
        log.info(`Neon Postgres: keeping existing ${SOURCE} data — new lots are added, existing ones updated.`);
    }
} else {
    log.warning("Neon Postgres: disabled (no DATABASE_URL) — writing local JSON only");
}

await crawler.run(startUrls);
const dataset = await Dataset.open();
const { items } = await dataset.getData();
log.info(`Total records saved: ${items.length}`);

if (items.length > 0) {
    await dataset.exportToCSV("copart-results");
    await dataset.exportToJSON("copart-results");
    log.info("Results saved to storage/datasets/default/ and key_value_stores/default/");
} else {
    log.error(
        `No listings were saved. Check the search-page errors above; dataset output is empty at ` +
            `${path.resolve(process.env.CRAWLEE_STORAGE_DIR ?? "storage", "datasets", "default")}.`
    );
    process.exitCode = 1;
}

// Report the database outcome explicitly — never let a run end looking fine
// while the database stayed empty.
if (DB_ENABLED) {
    log.info(`Neon Postgres: ${dbSaved} listing(s) written, ${dbFailed} failed`);
    if (dbFailed > 0) {
        log.error(
            `${dbFailed} listing(s) did NOT reach the database. The scraped JSON is still in ` +
                `storage/datasets/default/ — replay it with: npm run db:import`
        );
        process.exitCode = 1;
    } else if (dbSaved === 0 && items.length > 0) {
        log.error(
            `${items.length} record(s) were scraped but NONE reached the database. ` +
                `Replay them with: npm run db:import`
        );
        process.exitCode = 1;
    }
}

// Release the Neon connections so the process can exit.
await disconnectPrisma();
