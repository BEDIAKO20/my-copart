-- Re-centres the database on `products` as the MAIN table, for listings from
-- ANY kind of website (vehicles, car parts, electronics, food, …):
--
--   products ⭐        (was vehicles)
--    ├── category       flat: Vehicles, Car Parts, Electronics, …
--    ├── subcategory    NEW: Pickup Trucks, Phones, Laptops, TVs, … (was the
--    │                  child level of the old self-referencing category tree)
--    ├── source         + description
--    ├── product_images (was vehicle_images)
--    ├── current_bid    (vehicle_id -> product_id)
--    └── spec           (was specs)
--
-- Done IN PLACE with ALTER ... RENAME, so every existing row keeps its id.
--
-- SAFETY:
--   1. Before anything changes, every table is snapshotted into the
--      `pre_products_backup` schema. Nothing in it is touched afterwards; drop
--      it by hand once you've confirmed the migration (see README).
--   2. The final block re-checks the result against that snapshot and RAISEs
--      if anything is missing. The migration runs as one implicit transaction,
--      so a failed check rolls the whole thing back.

-- ── 0. Snapshot everything ──────────────────────────────────────────────────
CREATE SCHEMA "pre_products_backup";
CREATE TABLE "pre_products_backup"."vehicles"       AS TABLE "vehicles";
CREATE TABLE "pre_products_backup"."vehicle_images" AS TABLE "vehicle_images";
CREATE TABLE "pre_products_backup"."current_bid"    AS TABLE "current_bid";
CREATE TABLE "pre_products_backup"."specs"          AS TABLE "specs";
CREATE TABLE "pre_products_backup"."source"         AS TABLE "source";
CREATE TABLE "pre_products_backup"."category"       AS TABLE "category";
CREATE TABLE "pre_products_backup"."lots"           AS TABLE "lots";
DO $$
BEGIN
    IF to_regclass('lot_images') IS NOT NULL THEN
        EXECUTE 'CREATE TABLE "pre_products_backup"."lot_images" AS TABLE "lot_images"';
    END IF;
END $$;

-- ── 1. Repair drift: legacy lot_images ──────────────────────────────────────
-- The init migration created `lot_images`, but it was dropped outside of
-- Prisma on at least one database. Recreate it (empty) where missing so the
-- database matches the migration history and the Lot/LotImage models again.
-- A no-op wherever the table still exists.
CREATE TABLE IF NOT EXISTS "lot_images" (
    "id" SERIAL NOT NULL,
    "lot_id" INTEGER NOT NULL,
    "sort_order" INTEGER NOT NULL,
    "original" TEXT NOT NULL,
    "path" TEXT,
    "http_url" TEXT,
    "size_bytes" INTEGER,

    CONSTRAINT "lot_images_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "lot_images_lot_id_sort_order_idx" ON "lot_images"("lot_id", "sort_order");
CREATE UNIQUE INDEX IF NOT EXISTS "lot_images_lot_id_original_key" ON "lot_images"("lot_id", "original");
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lot_images_lot_id_fkey') THEN
        ALTER TABLE "lot_images" ADD CONSTRAINT "lot_images_lot_id_fkey"
            FOREIGN KEY ("lot_id") REFERENCES "lots"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- ── 2. source: + description ────────────────────────────────────────────────
ALTER TABLE "source" ADD COLUMN "description" TEXT;

-- ── 3. vehicles -> products ─────────────────────────────────────────────────
ALTER TABLE "vehicles" RENAME TO "products";
ALTER TABLE "products" RENAME CONSTRAINT "vehicles_pkey" TO "products_pkey";
ALTER TABLE "products" RENAME CONSTRAINT "vehicles_source_id_fkey" TO "products_source_id_fkey";
ALTER TABLE "products" RENAME CONSTRAINT "vehicles_category_id_fkey" TO "products_category_id_fkey";
ALTER INDEX "vehicles_source_id_external_id_key" RENAME TO "products_source_id_external_id_key";
ALTER INDEX "vehicles_source_id_idx" RENAME TO "products_source_id_idx";
ALTER INDEX "vehicles_category_id_idx" RENAME TO "products_category_id_idx";
ALTER INDEX "vehicles_make_model_idx" RENAME TO "products_make_model_idx";
ALTER INDEX "vehicles_year_idx" RENAME TO "products_year_idx";
ALTER INDEX "vehicles_last_scraped_at_idx" RENAME TO "products_last_scraped_at_idx";

-- Common product columns that every kind of website can fill.
ALTER TABLE "products"
    ADD COLUMN "brand" TEXT,
    ADD COLUMN "price" DECIMAL(12,2),
    ADD COLUMN "part_number" TEXT,
    ADD COLUMN "sku" TEXT,
    ADD COLUMN "rating" DECIMAL(4,2),
    ADD COLUMN "subcategory_id" UUID;

-- For a vehicle the brand IS the make.
UPDATE "products" SET "brand" = "make" WHERE "brand" IS NULL AND "make" IS NOT NULL;

-- `price` is the headline price on the product itself; for existing rows that
-- is what current_bid already held (Buy It Now, else the live bid).
UPDATE "products" p SET "price" = cb."price"
FROM "current_bid" cb
WHERE cb."vehicle_id" = p."id" AND cb."price" IS NOT NULL;

-- ── 4. category tree -> category + subcategory ──────────────────────────────
CREATE TABLE "subcategory" (
    "id" UUID NOT NULL,
    "category_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subcategory_pkey" PRIMARY KEY ("id")
);

-- The old tree was only ever two levels deep. Refuse to guess at anything deeper.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM "category" c
        JOIN "category" p ON p."id" = c."parent_id"
        WHERE p."parent_id" IS NOT NULL
    ) THEN
        RAISE EXCEPTION 'category tree is deeper than 2 levels; migrate it by hand';
    END IF;
END $$;

-- Child nodes become subcategories, keeping their ids.
INSERT INTO "subcategory" ("id", "category_id", "name", "description", "created_at")
SELECT "id", "parent_id", "name", "description", "created_at"
FROM "category" WHERE "parent_id" IS NOT NULL;

-- Products linked to a child node now point at its root + the subcategory.
UPDATE "products" p
SET "subcategory_id" = s."id", "category_id" = s."category_id"
FROM "subcategory" s
WHERE p."category_id" = s."id";

-- Products that only had scraped category TEXT (no tree link): link by name,
-- creating the category/subcategory when needed.
INSERT INTO "category" ("id", "name")
SELECT gen_random_uuid(), t."category"
FROM (SELECT DISTINCT "category" FROM "products" WHERE "category_id" IS NULL AND "category" IS NOT NULL) t
WHERE NOT EXISTS (SELECT 1 FROM "category" c WHERE c."parent_id" IS NULL AND c."name" = t."category");

UPDATE "products" p SET "category_id" = c."id"
FROM "category" c
WHERE p."category_id" IS NULL AND c."parent_id" IS NULL AND c."name" = p."category";

INSERT INTO "subcategory" ("id", "category_id", "name")
SELECT gen_random_uuid(), t."category_id", t."subcategory"
FROM (
    SELECT DISTINCT "category_id", "subcategory" FROM "products"
    WHERE "subcategory_id" IS NULL AND "subcategory" IS NOT NULL AND "category_id" IS NOT NULL
) t
WHERE NOT EXISTS (
    SELECT 1 FROM "subcategory" s WHERE s."category_id" = t."category_id" AND s."name" = t."subcategory"
);

UPDATE "products" p SET "subcategory_id" = s."id"
FROM "subcategory" s
WHERE p."subcategory_id" IS NULL AND s."category_id" = p."category_id" AND s."name" = p."subcategory";

-- Child rows now live in `subcategory` (and in the snapshot) — flatten `category`.
DELETE FROM "category" WHERE "parent_id" IS NOT NULL;
ALTER TABLE "category" DROP CONSTRAINT "category_parent_id_fkey";
DROP INDEX "category_parent_id_idx";
DROP INDEX "category_parent_id_name_key";
DROP INDEX "category_root_name_key";
ALTER TABLE "category" DROP COLUMN "parent_id";
CREATE UNIQUE INDEX "category_name_key" ON "category"("name");

CREATE UNIQUE INDEX "subcategory_category_id_name_key" ON "subcategory"("category_id", "name");
CREATE INDEX "subcategory_category_id_idx" ON "subcategory"("category_id");
ALTER TABLE "subcategory" ADD CONSTRAINT "subcategory_category_id_fkey"
    FOREIGN KEY ("category_id") REFERENCES "category"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "products_subcategory_id_idx" ON "products"("subcategory_id");
ALTER TABLE "products" ADD CONSTRAINT "products_subcategory_id_fkey"
    FOREIGN KEY ("subcategory_id") REFERENCES "subcategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- The denormalized text copies are replaced by the category_id/subcategory_id
-- FKs. Only drop them once every value is provably represented by a link.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM "products" p LEFT JOIN "category" c ON c."id" = p."category_id"
        WHERE p."category" IS NOT NULL AND c."name" IS DISTINCT FROM p."category"
    ) THEN
        RAISE EXCEPTION 'products.category text not fully represented by category_id';
    END IF;
    IF EXISTS (
        SELECT 1 FROM "products" p LEFT JOIN "subcategory" s ON s."id" = p."subcategory_id"
        WHERE p."subcategory" IS NOT NULL AND s."name" IS DISTINCT FROM p."subcategory"
    ) THEN
        RAISE EXCEPTION 'products.subcategory text not fully represented by subcategory_id';
    END IF;
END $$;
ALTER TABLE "products" DROP COLUMN "category", DROP COLUMN "subcategory";

CREATE INDEX "products_brand_idx" ON "products"("brand");
CREATE INDEX "products_sku_idx" ON "products"("sku");
CREATE INDEX "products_part_number_idx" ON "products"("part_number");
CREATE INDEX "products_price_idx" ON "products"("price");

-- ── 5. vehicle_images -> product_images ─────────────────────────────────────
ALTER TABLE "vehicle_images" RENAME TO "product_images";
ALTER TABLE "product_images" RENAME COLUMN "vehicle_id" TO "product_id";
ALTER TABLE "product_images" RENAME COLUMN "local_path" TO "path";
ALTER TABLE "product_images" RENAME COLUMN "size_bytes" TO "size";
ALTER TABLE "product_images" RENAME CONSTRAINT "vehicle_images_pkey" TO "product_images_pkey";
ALTER TABLE "product_images" RENAME CONSTRAINT "vehicle_images_vehicle_id_fkey" TO "product_images_product_id_fkey";
ALTER INDEX "vehicle_images_vehicle_id_image_url_key" RENAME TO "product_images_product_id_image_url_key";
ALTER INDEX "vehicle_images_vehicle_id_sort_order_idx" RENAME TO "product_images_product_id_sort_order_idx";

-- ── 6. current_bid: vehicle_id -> product_id ────────────────────────────────
ALTER TABLE "current_bid" RENAME COLUMN "vehicle_id" TO "product_id";
ALTER TABLE "current_bid" RENAME CONSTRAINT "current_bid_vehicle_id_fkey" TO "current_bid_product_id_fkey";
ALTER INDEX "current_bid_vehicle_id_key" RENAME TO "current_bid_product_id_key";

-- ── 7. specs -> spec ────────────────────────────────────────────────────────
ALTER TABLE "specs" RENAME TO "spec";
ALTER TABLE "spec" RENAME COLUMN "vehicle_id" TO "product_id";
ALTER TABLE "spec" RENAME CONSTRAINT "specs_pkey" TO "spec_pkey";
ALTER TABLE "spec" RENAME CONSTRAINT "specs_vehicle_id_fkey" TO "spec_product_id_fkey";
ALTER INDEX "specs_vehicle_id_key_key" RENAME TO "spec_product_id_key_key";
ALTER INDEX "specs_key_idx" RENAME TO "spec_key_idx";

-- ── 8. Verify against the snapshot ──────────────────────────────────────────
DO $$
DECLARE
    missing BIGINT;
BEGIN
    SELECT COUNT(*) INTO missing FROM "pre_products_backup"."vehicles" v
    WHERE NOT EXISTS (
        SELECT 1 FROM "products" p
        WHERE p."id" = v."id" AND p."source_id" = v."source_id" AND p."external_id" = v."external_id"
    );
    IF missing > 0 THEN RAISE EXCEPTION 'verify: % vehicle(s) missing from products', missing; END IF;

    SELECT COUNT(*) INTO missing FROM "pre_products_backup"."vehicle_images" o
    WHERE NOT EXISTS (
        SELECT 1 FROM "product_images" n
        WHERE n."id" = o."id" AND n."product_id" = o."vehicle_id" AND n."image_url" = o."image_url"
    );
    IF missing > 0 THEN RAISE EXCEPTION 'verify: % image(s) missing from product_images', missing; END IF;

    SELECT COUNT(*) INTO missing FROM "pre_products_backup"."current_bid" o
    WHERE NOT EXISTS (
        SELECT 1 FROM "current_bid" n
        WHERE n."id" = o."id" AND n."product_id" = o."vehicle_id" AND n."price" IS NOT DISTINCT FROM o."price"
    );
    IF missing > 0 THEN RAISE EXCEPTION 'verify: % current_bid row(s) missing', missing; END IF;

    SELECT COUNT(*) INTO missing FROM "pre_products_backup"."specs" o
    WHERE NOT EXISTS (
        SELECT 1 FROM "spec" n
        WHERE n."id" = o."id" AND n."product_id" = o."vehicle_id" AND n."key" = o."key" AND n."value" = o."value"
    );
    IF missing > 0 THEN RAISE EXCEPTION 'verify: % spec row(s) missing', missing; END IF;

    SELECT COUNT(*) INTO missing FROM "pre_products_backup"."source" o
    WHERE NOT EXISTS (SELECT 1 FROM "source" n WHERE n."id" = o."id");
    IF missing > 0 THEN RAISE EXCEPTION 'verify: % source row(s) missing', missing; END IF;

    -- Every old category node survives, as either a category or a subcategory.
    SELECT COUNT(*) INTO missing FROM "pre_products_backup"."category" o
    WHERE NOT EXISTS (SELECT 1 FROM "category" n WHERE n."id" = o."id" AND o."parent_id" IS NULL)
      AND NOT EXISTS (SELECT 1 FROM "subcategory" n WHERE n."id" = o."id" AND n."category_id" = o."parent_id");
    IF missing > 0 THEN RAISE EXCEPTION 'verify: % category node(s) missing', missing; END IF;

    -- Every product that had a category still has one.
    SELECT COUNT(*) INTO missing FROM "pre_products_backup"."vehicles" v
    JOIN "products" p ON p."id" = v."id"
    WHERE (v."category_id" IS NOT NULL OR v."category" IS NOT NULL) AND p."category_id" IS NULL;
    IF missing > 0 THEN RAISE EXCEPTION 'verify: % product(s) lost their category', missing; END IF;
END $$;
