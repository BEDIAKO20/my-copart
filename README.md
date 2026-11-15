# my-copart

Product listings scraped from many websites — vehicles, car parts, food,
electronics, anything — normalized into one universal PostgreSQL structure on
Neon via Prisma ORM.

The Crawlee/Playwright Copart scraper in [src/main.ts](src/main.ts) is one
**source** among many. Every site is converted by a normalizer into the same
shape, so all listings land in the same `products` table regardless of where
they came from or what they are.

## Setup

1. Install dependencies (this also runs `prisma generate`):

   ```bash
   npm install
   ```

2. Create your `.env` from the template:

   ```bash
   cp .env.example .env
   ```

   Both URLs come from the [Neon console](https://console.neon.tech) → your
   project → **Connect**, and differ only by `-pooler` in the hostname:

   - `DATABASE_URL` — **pooled** endpoint, used by the app at runtime.
   - `DIRECT_URL` — **direct** endpoint, used by Prisma Migrate. Schema changes
     need a real session, which the PgBouncer pooler can't provide.

   Credentials are only ever read from the environment; nothing is hard-coded.

3. Apply the schema:

   ```bash
   npm run db:migrate
   ```

## Database structure

```
products ⭐                 THE MAIN TABLE — every website writes in here
 ├── category               Vehicles, Car Parts, Food, Electronics, …
 ├── subcategory            Pickup Trucks, Phones, Laptops, TVs, …
 ├── source                 which website this row came from
 ├── product_images         photos, in listing order
 ├── current_bid            auction data — only for listings that have it
 └── spec                   key/value: VIN, odometer, RAM, screen size, …
```

Defined in [prisma/schema.prisma](prisma/schema.prisma). There is no per-site
table — a new website is a new row in `source`, never a new table.

| Table | Holds |
| --- | --- |
| `products` ⭐ | `id`, `name`, `brand`, `price`, `part_number`, `sku`, `description`, `rating`, `url`, `category_id`, `category_name` (denormalized, no join needed), `subcategory_id`, `source_id`, `created_at`, `updated_at` — plus `external_id` (the site's own listing id, the dedup key), `raw` (the untouched scraped JSON) and `last_scraped_at`. |
| `category` | `id`, `name` (unique), `description`, `created_at`. |
| `subcategory` | `id`, `category_id`, `name` (unique per category), `description`, `created_at`. |
| `source` | `id`, `name`, `description`, `created_at` — plus `slug` (`copart`, …; the stable key normalizers use), `url`, `type`. |
| `product_images` | `id`, `product_id`, `image_url`, `path`, `size`, `is_primary`, `created_at` — plus `sort_order`. |
| `current_bid` | `id`, `product_id` (one row per product), `lot_number`, `price`, `bid_now`, `buy_it_now`, `pure_sale`, `auctions`, `sale_date`, `sale_name`, `created_at` — plus `currency`, `updated_at`. |
| `spec` | `id`, `product_id`, `key`, `value`, `created_at`. Anything that isn't a `products` column, so a new site never needs a schema change — including vehicle-specific attributes like `Year` / `Make` / `Model` / `VIN`, which live ONLY here, not as their own `products` columns. |

`products.price` is the headline price — the asking price on retail sites, Buy
It Now or the live bid on auction sites — so every source sorts together.

### Deduplication

`products` has a unique constraint on **`(source_id, external_id)`**, where
`external_id` is whatever the site calls its own listing (Copart lot number,
an ASIN, a shop's product id, …). Re-scraping a listing **updates** the existing
row instead of inserting another. The same id on two different websites stays
two separate products, as it should.

## Normalization layer

Different sites return completely different JSON. Each one gets a normalizer in
[src/normalize/](src/normalize/) that maps its payload onto the shared
`NormalizedListing` shape defined in
[src/normalize/types.ts](src/normalize/types.ts):

```
Copart record   → normalize("copart", raw)    ┐
IAAI record     → normalize("iaai", raw)      ├→ NormalizedListing → upsertListing() → products
Best Buy record → normalize("best-buy", raw)  ┘
```

Only the normalizer knows about a site. [src/db/listings.ts](src/db/listings.ts)
— the single place that writes to the database — never sees site-specific fields.

### Adding a new website

1. Create `src/normalize/<site>.ts` exporting a `Normalizer`. Copy
   [src/normalize/copart.ts](src/normalize/copart.ts) as a starting point and use
   the parsers in [src/normalize/helpers.ts](src/normalize/helpers.ts)
   (`text`, `int`, `money`, `date`, `splitVehicleTitle`, …).
   - Fill the common `product` fields the site has (`brand`, `price`, `sku`,
     `partNumber`, `rating`, …) and leave the rest `null`.
   - Set `category` / `subcategory`, e.g. `"Electronics"` / `"Laptops"`. They
     are created on first use and shared by every site.
   - Put everything else in `specs`.
   - Set `currentBid: null` unless the listing has auction data.
2. Register it in [src/normalize/index.ts](src/normalize/index.ts).
3. Save records with `saveScraped("<site>", rawRecord)`.

No schema change, no new table, no change to the write path.

## Usage

| Command | What it does |
| --- | --- |
| `npm start` | Runs the Copart crawler. Writes local JSON **and** upserts each lot straight into `products`. |
| `npm run db:import` | Imports `storage/datasets/default/` as Copart. |
| `npm run db:import -- iaai storage/datasets/iaai` | Imports another site's dataset through its normalizer. |
| `npm run db:check` | Prints row counts, the category tree, integrity checks, and a sample product — the fastest way to confirm what's actually in Neon. |
| `npm run db:archive` | Dry run — shows what `db:archive -- --confirm` would move and clear, touches nothing. |
| `npm run db:archive -- --confirm` | Copies everything to the archive database, verifies it landed, then clears the primary database. See **Archiving** below. |
| `npm run db:archive:setup` | Applies migrations to the archive database. Run once before the first `db:archive`. |
| `npm run db:migrate` | Creates and applies a migration after editing the schema. |
| `npm run db:deploy` | Applies existing migrations (production/CI). |
| `npm run db:studio` | Browse the data in Prisma Studio. |
| `npm run build` | Regenerates the client and compiles to `dist/`. |

If `DATABASE_URL` is unset the crawler still runs and writes local JSON only. A
database error during a crawl is logged and skipped rather than aborting the
run; replay those listings afterwards with `npm run db:import`.

The Copart crawler stores the original sale date and sale name in each dataset
record's `currentBid`. The database stores them on `current_bid` (and retains
the original text in `spec`). After pulling a schema change, run
`npm run db:deploy` before scraping or importing records.

## Archiving

`npm start` always **adds to** whatever's already in the primary database —
re-scraping updates existing rows, it never wipes anything on its own. If you
want a crawl to start from an empty database without losing what's there,
move the old data out first with `npm run db:archive`:

1. Add `ARCHIVE_DATABASE_URL` and `ARCHIVE_DIRECT_URL` to `.env` — a second,
   separate Postgres database (see `.env.example`). Neon, or anything else
   that speaks Postgres, works.
2. `npm run db:archive:setup` — applies the same migrations to it, once.
3. `npm run db:archive` — dry run. Prints what's currently in the primary
   database and what *would* happen; nothing is touched yet.
4. `npm run db:archive -- --confirm` — copies every table (products, images,
   bids, specs, source, category, subcategory) into the archive database,
   **verifies the copy landed** (every table's row count checked), and only
   then clears the primary database.
5. `npm start` — crawls into a clean `products` table.

If the copy can't be verified, or anything fails partway, the primary database
is left exactly as it was — it's only ever cleared after a confirmed, verified
copy. This is a separate, manual step by design, not something `npm start`
does automatically: an accidental double-run of the crawler should never be
able to wipe your data.

## Migration to `products` (2026-09-26)

Migration `20260926000000_products_main_table` moved the database from the old
`vehicles`-centred layout to `products`, **in place** (renames — every row kept
its id):

| Before | After |
| --- | --- |
| `vehicles` | `products` (+ `brand`, `price`, `part_number`, `sku`, `rating`, `subcategory_id`) |
| `category` tree (`parent_id`) | flat `category` + `subcategory` |
| `vehicle_images` (`local_path`, `size_bytes`) | `product_images` (`path`, `size`) |
| `current_bid.vehicle_id` | `current_bid.product_id` |
| `specs` | `spec` |

Safety measures:

- Before changing anything it copied every table into the
  **`pre_products_backup`** schema. Nothing touches that schema afterwards.
- It checks itself against that copy (every product, image, bid, spec,
  source and category node, matched by id) and rolls back if anything is
  missing.

### Cleanup — done (2026-09-27)

Both steps below have been carried out:

1. The legacy flat `lots` / `lot_images` tables were confirmed empty (0 rows)
   and dropped in `20260927020000_drop_legacy_lots_tables`. The `Lot` /
   `LotImage` Prisma models, `src/normalize/legacy-lot.ts`, and
   `src/db/backfill.ts` (`npm run db:backfill`) were removed along with them —
   there was nothing left for that script to migrate.
2. The `pre_products_backup` schema from the `products` migration is still
   sitting in Neon, untouched. Drop it by hand once you're fully satisfied:
   `DROP SCHEMA pre_products_backup CASCADE;` (Neon SQL editor).

### Re-scrapes are non-destructive

Sites intermittently return a listing with its data missing (4 of the first 20
Copart records came back blank). To stop a failed scrape from wiping good rows:

- Empty strings become `null` during normalization.
- Null fields are stripped from updates, so stored values survive a blank
  re-scrape.
- `current_bid` is only written when the normalizer returns auction data
  (`currentBid` not null) — i.e. the scrape actually read a price.
- A category/subcategory link is only replaced, never cleared, by a re-scrape.
- Images are only replaced when the scrape returned at least one image.
- `created_at` is preserved; `last_scraped_at` updates on every write.

## Example queries

```ts
import { getPrisma } from "./src/db/prisma.js";
const prisma = getPrisma();

// Every source at once: cheapest laptops under $1,000
await prisma.product.findMany({
    where: { subcategory: { name: "Laptops" }, price: { lte: 1_000 } },
    include: { images: { where: { isPrimary: true } }, source: true },
    orderBy: { price: "asc" },
});

// All vehicles, Fords, any site — Year/Make/Model live only in `spec`
await prisma.product.findMany({
    where: {
        category: { name: "Vehicles" },
        specs: { some: { key: "Make", value: "FORD" } },
    },
    include: { currentBid: true, source: true, specs: true },
});

// One site only
await prisma.product.findMany({ where: { source: { slug: "copart" } } });

// Look a listing up by its site id (the dedup key)
await prisma.product.findUnique({
    where: { sourceId_externalId: { sourceId, externalId: "95638805" } },
    include: { currentBid: true, images: true, specs: true },
});

// Live auction listings scraped in the last 24 hours, any site
await prisma.product.findMany({
    where: {
        currentBid: { auctions: true },
        lastScrapedAt: { gte: new Date(Date.now() - 864e5) },
    },
    include: { currentBid: true, source: true },
    orderBy: { lastScrapedAt: "desc" },
});
```

## Project layout

```
prisma/schema.prisma      data model (source of truth)
prisma/migrations/        generated SQL migrations — commit these
prisma.config.ts          Prisma 7 CLI config; points migrations at DIRECT_URL
src/normalize/types.ts    the shared NormalizedListing contract
src/normalize/helpers.ts  parsing helpers for normalizers
src/normalize/copart.ts   Copart normalizer
src/normalize/registry.ts    slug -> normalizer lookup
src/db/prisma.ts          PrismaClient + pg driver adapter
src/db/categories.ts      get-or-create for category / subcategory
src/db/listings.ts        the only writer: upsertListing / saveScraped
src/db/import.ts          dataset import
src/db/check.ts           prints row counts, integrity checks, a sample product
src/db/archive.ts         copies everything to a second database, then clears the primary
src/db/archive-prisma.ts  PrismaClient for the archive database
src/db/archive-setup.ts   applies migrations to the archive database
src/main.ts               the Copart crawler
```

## Learn more

- [Crawlee](https://crawlee.dev/js/docs/introduction)
- [Prisma ORM 7](https://www.prisma.io/docs/orm/v7)
- [Neon](https://neon.tech/docs/introduction)
