-- Adds a denormalized `category_name` column directly on `products`, so the
-- top-level category (e.g. "Vehicles", "Electronics", "Car Parts", "Food
-- Items") is visible on the product row itself without joining to `category`.
--
-- Kept in sync by the application on every write (see
-- src/db/categories.ts + src/db/listings.ts) — this migration only adds the
-- column and backfills rows that already exist.

-- AlterTable
ALTER TABLE "products" ADD COLUMN "category_name" TEXT;

-- Backfill existing rows from the category they're already linked to.
UPDATE "products" p
SET "category_name" = c."name"
FROM "category" c
WHERE p."category_id" = c."id";

-- CreateIndex
CREATE INDEX "products_category_name_idx" ON "products"("category_name");
