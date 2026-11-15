/**
 * Shared parsing helpers for normalizers. Scrapers hand us strings and use ""
 * for "not found", so these turn blanks into null — letting the database tell a
 * failed scrape apart from a genuinely empty field.
 */
import type { NormalizedSpec } from "./types.js";

export function text(value: unknown): string | null {
    if (typeof value !== "string") {
        return value === null || value === undefined ? null : text(String(value));
    }
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
}

/** First integer in the value: "30,077 mi  Actual" -> 30077. */
export function int(value: unknown): number | null {
    const raw = text(value);
    const digits = raw?.replace(/,/g, "").match(/\d+/);
    if (!digits) return null;
    const parsed = Number.parseInt(digits[0], 10);
    return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Money in MAJOR units: "$11,300.00USD" -> 11300. Null when there is no number.
 * `products.price` / `current_bid.price` are DECIMAL(12,2), so no cents
 * conversion is needed.
 */
export function money(value: unknown): number | null {
    const raw = text(value);
    const match = raw?.replace(/,/g, "").match(/\d+(\.\d+)?/);
    if (!match) return null;
    const parsed = Number.parseFloat(match[0]);
    return Number.isFinite(parsed) ? parsed : null;
}

/** "Tue. Sep 15, 2026 04:00 PM GMT" -> Date. Null when unparseable. */
export function date(value: unknown): Date | null {
    const raw = text(value);
    if (!raw) return null;
    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** A value only counts as a price if it contains a digit — sites echo back
 *  their own field label (e.g. "Current bid") as a placeholder. */
export function looksLikePrice(value: unknown): boolean {
    const raw = text(value);
    return raw !== null && /\d/.test(raw);
}

/** [{key, value}] -> {key: value}, dropping blanks. */
export function keyValueListToObject(
    list: { key?: string; value?: string }[] | null | undefined
): Record<string, string> {
    const out: Record<string, string> = {};
    for (const entry of list ?? []) {
        const key = entry?.key;
        const value = text(entry?.value);
        if (key && value) out[key] = value;
    }
    return out;
}

/**
 * {key: value} -> `spec` rows, dropping blanks and de-duplicating keys.
 * `spec` is uniqued on (product_id, key), so a duplicate key would abort the write.
 */
export function toSpecs(source: Record<string, unknown>): NormalizedSpec[] {
    const seen = new Set<string>();
    const out: NormalizedSpec[] = [];
    for (const [rawKey, rawValue] of Object.entries(source)) {
        const key = text(rawKey);
        const value = text(rawValue);
        if (!key || !value || seen.has(key)) continue;
        seen.add(key);
        out.push({ key, value });
    }
    return out;
}

/** Pulls "2017", "FORD", "F150" out of a title like "2017 FORD F150 SUPERCREW". */
export function splitVehicleTitle(title: string | null): {
    year: number | null;
    make: string | null;
    model: string | null;
    trim: string | null;
} {
    const match = title?.match(/^(\d{4})\s+(\S+)\s+(\S+)(?:\s+(.*))?$/);
    if (!match) return { year: null, make: null, model: null, trim: null };
    return {
        year: int(match[1]),
        make: text(match[2]),
        model: text(match[3]),
        trim: text(match[4]),
    };
}

/** "Copart" -> "copart", "Cars.com" -> "cars-com". */
export function slugify(value: string): string {
    return (
        value
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-+|-+$/g, "") || "unknown"
    );
}
