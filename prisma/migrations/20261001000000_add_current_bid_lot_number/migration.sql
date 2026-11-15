-- Moves the lot number out of `spec` (key "Lot Number") and onto `current_bid`
-- as its own `lot_number` column, so it can be shown alongside the bid without
-- a lookup into the key/value table.
--
-- Written by the application from now on (see src/normalize/copart.ts +
-- src/db/listings.ts) — this migration adds the column and moves the rows that
-- already exist.

-- AlterTable
ALTER TABLE "current_bid" ADD COLUMN "lot_number" TEXT;

-- Backfill existing rows from the spec they were stored in.
UPDATE "current_bid" cb
SET "lot_number" = s."value"
FROM "spec" s
WHERE s."product_id" = cb."product_id"
  AND s."key" = 'Lot Number';

-- Remove the spec rows that were moved. A product with no `current_bid` row
-- keeps its spec, so no lot number is lost.
DELETE FROM "spec" s
USING "current_bid" cb
WHERE s."product_id" = cb."product_id"
  AND s."key" = 'Lot Number'
  AND cb."lot_number" IS NOT NULL;
