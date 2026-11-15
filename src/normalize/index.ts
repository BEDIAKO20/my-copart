/**
 * Normalizer registry wiring.
 *
 * ── Adding a new website (any product type) ───────────────────────────────────
 * 1. Create src/normalize/<site>.ts exporting a `Normalizer` (copy copart.ts as
 *    a starting point) that maps that site's scraped JSON onto NormalizedListing,
 *    including its `category` / `subcategory` (e.g. "Electronics" / "Laptops").
 * 2. Register it below.
 * That's all — the schema, the upsert and the deduplication are already shared,
 * so the new site's listings land in the same `products` table as everything
 * else.
 */
import { registerNormalizer } from "./registry.js";
import { copartNormalizer } from "./copart.js";

registerNormalizer(copartNormalizer);

// Future sites go here, e.g.:
// registerNormalizer(iaaiNormalizer);
// registerNormalizer(bestBuyNormalizer);

export * from "./types.js";
export { getNormalizer, listNormalizers, normalize, registerNormalizer } from "./registry.js";
export { copartNormalizer } from "./copart.js";
