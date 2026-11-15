-- `brand` always duplicated `make` for every site scraped so far (Copart sets
-- brand = make; the legacy `lots.brand` column fell back to `lots.make` too).
-- Dropping it — `make` is the single source of truth going forward.

-- DropIndex
DROP INDEX "cars_brand_idx";

-- AlterTable
ALTER TABLE "cars" DROP COLUMN "brand";
