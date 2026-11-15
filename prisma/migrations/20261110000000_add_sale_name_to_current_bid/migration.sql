ALTER TABLE "current_bid" ADD COLUMN "sale_name" TEXT;

UPDATE "current_bid" AS cb
SET "sale_name" = s."value"
FROM "spec" AS s
WHERE s."product_id" = cb."product_id"
  AND s."key" = 'Sale Name'
  AND cb."sale_name" IS NULL;
