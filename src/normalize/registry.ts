import type { Normalizer, NormalizedListing } from "./types.js";

const registry = new Map<string, Normalizer<any>>();

export function registerNormalizer<TRaw>(normalizer: Normalizer<TRaw>): void {
    registry.set(normalizer.source.slug, normalizer);
}

export function getNormalizer(slug: string): Normalizer<any> {
    const normalizer = registry.get(slug);
    if (!normalizer) {
        throw new Error(
            `No normalizer registered for source "${slug}". ` +
                `Known sources: ${[...registry.keys()].join(", ") || "(none)"}. ` +
                `Add one in src/normalize/ and register it in src/normalize/index.ts.`
        );
    }
    return normalizer;
}

export function listNormalizers(): Normalizer<any>[] {
    return [...registry.values()];
}

/**
 * Converts a site's scraped record into the common shape.
 * Returns null when the record isn't a usable listing.
 */
export function normalize(slug: string, raw: unknown): NormalizedListing | null {
    return getNormalizer(slug).normalize(raw);
}
