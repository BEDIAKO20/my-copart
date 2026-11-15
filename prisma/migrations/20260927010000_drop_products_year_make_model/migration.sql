-- Removes `year` / `make` / `model` as their own columns on `products`.
-- They now live ONLY in `spec` (as "Year" / "Make" / "Model" rows) — see
-- src/main.ts's buildSpecs() and src/normalize/copart.ts, which already read
-- "Make" back out of `spec` to compute `products.brand`.
--
-- `brand` and `category_name` are untouched — this migration only removes the
-- duplicate vehicle-shaped columns, not the generic product ones.

-- DropIndex
DROP INDEX "products_make_model_idx";
DROP INDEX "products_year_idx";

-- AlterTable
ALTER TABLE "products"
    DROP COLUMN "year",
    DROP COLUMN "make",
    DROP COLUMN "model";
