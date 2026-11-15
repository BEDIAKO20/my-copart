-- Renames the main table from `cars` to `vehicles`, and every dependent
-- table/column that referenced it, WITHOUT dropping or recreating anything —
-- ALTER ... RENAME preserves all existing rows and their ids.
--
--   vehicles ⭐ (was cars)
--    ├── vehicle_images (was car_images, car_id -> vehicle_id)
--    ├── current_bid    (car_id -> vehicle_id)
--    ├── specs          (car_id -> vehicle_id)
--    ├── source
--    └── category

-- ── cars -> vehicles ────────────────────────────────────────────────────────
ALTER TABLE "cars" RENAME TO "vehicles";
ALTER TABLE "vehicles" RENAME CONSTRAINT "cars_pkey" TO "vehicles_pkey";
ALTER TABLE "vehicles" RENAME CONSTRAINT "cars_source_id_fkey" TO "vehicles_source_id_fkey";
ALTER TABLE "vehicles" RENAME CONSTRAINT "cars_category_id_fkey" TO "vehicles_category_id_fkey";
ALTER INDEX "cars_source_id_external_id_key" RENAME TO "vehicles_source_id_external_id_key";
ALTER INDEX "cars_source_id_idx" RENAME TO "vehicles_source_id_idx";
ALTER INDEX "cars_category_id_idx" RENAME TO "vehicles_category_id_idx";
ALTER INDEX "cars_make_model_idx" RENAME TO "vehicles_make_model_idx";
ALTER INDEX "cars_year_idx" RENAME TO "vehicles_year_idx";
ALTER INDEX "cars_last_scraped_at_idx" RENAME TO "vehicles_last_scraped_at_idx";

-- ── car_images -> vehicle_images, car_id -> vehicle_id ─────────────────────
ALTER TABLE "car_images" RENAME TO "vehicle_images";
ALTER TABLE "vehicle_images" RENAME COLUMN "car_id" TO "vehicle_id";
ALTER TABLE "vehicle_images" RENAME CONSTRAINT "car_images_pkey" TO "vehicle_images_pkey";
ALTER TABLE "vehicle_images" RENAME CONSTRAINT "car_images_car_id_fkey" TO "vehicle_images_vehicle_id_fkey";
ALTER INDEX "car_images_car_id_image_url_key" RENAME TO "vehicle_images_vehicle_id_image_url_key";
ALTER INDEX "car_images_car_id_sort_order_idx" RENAME TO "vehicle_images_vehicle_id_sort_order_idx";

-- ── current_bid: car_id -> vehicle_id ───────────────────────────────────────
ALTER TABLE "current_bid" RENAME COLUMN "car_id" TO "vehicle_id";
ALTER TABLE "current_bid" RENAME CONSTRAINT "current_bid_car_id_fkey" TO "current_bid_vehicle_id_fkey";
ALTER INDEX "current_bid_car_id_key" RENAME TO "current_bid_vehicle_id_key";

-- ── specs: car_id -> vehicle_id ─────────────────────────────────────────────
ALTER TABLE "specs" RENAME COLUMN "car_id" TO "vehicle_id";
ALTER TABLE "specs" RENAME CONSTRAINT "specs_car_id_fkey" TO "specs_vehicle_id_fkey";
ALTER INDEX "specs_car_id_key_key" RENAME TO "specs_vehicle_id_key_key";
