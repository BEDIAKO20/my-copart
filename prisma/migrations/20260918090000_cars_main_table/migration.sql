-- Restructures the database around `cars` as the MAIN table.
--
--   cars ⭐
--    ├── car_images
--    ├── current_bid
--    ├── specs
--    ├── source
--    └── category
--
-- Every scraped website writes into this same `cars` table; a new site is a new
-- row in `source`, never a new table.
--
-- The legacy `lots` / `lot_images` tables from the init migration are left
-- untouched so `npm run db:backfill` can copy their rows across. Drop them in a
-- later migration once the backfill has been verified.

-- CreateTable
CREATE TABLE "source" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT,
    "type" TEXT NOT NULL DEFAULT 'auction',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "source_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "category" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "parent_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cars" (
    "id" UUID NOT NULL,
    "url" TEXT NOT NULL,
    "name" TEXT,
    "brand" TEXT,
    "category" TEXT,
    "subcategory" TEXT,
    "year" INTEGER,
    "make" TEXT,
    "model" TEXT,
    "description" TEXT,
    "source_id" UUID NOT NULL,
    "external_id" TEXT NOT NULL,
    "category_id" UUID,
    "raw" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_scraped_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cars_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "car_images" (
    "id" UUID NOT NULL,
    "car_id" UUID NOT NULL,
    "image_url" TEXT NOT NULL,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "local_path" TEXT,
    "size_bytes" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "car_images_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "current_bid" (
    "id" UUID NOT NULL,
    "car_id" UUID NOT NULL,
    "price" DECIMAL(12,2),
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "bid_now" BOOLEAN NOT NULL DEFAULT false,
    "buy_it_now" BOOLEAN NOT NULL DEFAULT false,
    "pure_sale" BOOLEAN NOT NULL DEFAULT false,
    "auctions" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "current_bid_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "specs" (
    "id" UUID NOT NULL,
    "car_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "specs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "source_slug_key" ON "source"("slug");

-- CreateIndex
CREATE INDEX "category_parent_id_idx" ON "category"("parent_id");

-- CreateIndex
CREATE UNIQUE INDEX "category_parent_id_name_key" ON "category"("parent_id", "name");

-- CreateIndex
CREATE INDEX "cars_source_id_idx" ON "cars"("source_id");

-- CreateIndex
CREATE INDEX "cars_category_id_idx" ON "cars"("category_id");

-- CreateIndex
CREATE INDEX "cars_make_model_idx" ON "cars"("make", "model");

-- CreateIndex
CREATE INDEX "cars_year_idx" ON "cars"("year");

-- CreateIndex
CREATE INDEX "cars_brand_idx" ON "cars"("brand");

-- CreateIndex
CREATE INDEX "cars_last_scraped_at_idx" ON "cars"("last_scraped_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "cars_source_id_external_id_key" ON "cars"("source_id", "external_id");

-- CreateIndex
CREATE INDEX "car_images_car_id_sort_order_idx" ON "car_images"("car_id", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "car_images_car_id_image_url_key" ON "car_images"("car_id", "image_url");

-- CreateIndex
CREATE UNIQUE INDEX "current_bid_car_id_key" ON "current_bid"("car_id");

-- CreateIndex
CREATE INDEX "current_bid_price_idx" ON "current_bid"("price");

-- CreateIndex
CREATE INDEX "specs_key_idx" ON "specs"("key");

-- CreateIndex
CREATE UNIQUE INDEX "specs_car_id_key_key" ON "specs"("car_id", "key");

-- AddForeignKey
ALTER TABLE "category" ADD CONSTRAINT "category_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "category"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cars" ADD CONSTRAINT "cars_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "source"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cars" ADD CONSTRAINT "cars_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "car_images" ADD CONSTRAINT "car_images_car_id_fkey" FOREIGN KEY ("car_id") REFERENCES "cars"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "current_bid" ADD CONSTRAINT "current_bid_car_id_fkey" FOREIGN KEY ("car_id") REFERENCES "cars"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "specs" ADD CONSTRAINT "specs_car_id_fkey" FOREIGN KEY ("car_id") REFERENCES "cars"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── Beyond what Prisma generates ────────────────────────────────────────────
-- Postgres treats NULLs as distinct in a unique constraint, so
-- "category_parent_id_name_key" does NOT stop two top-level categories both
-- called "Vehicles". This partial index closes that hole.
CREATE UNIQUE INDEX "category_root_name_key" ON "category"("name") WHERE "parent_id" IS NULL;
