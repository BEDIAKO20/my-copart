-- CreateTable
CREATE TABLE "lots" (
    "id" SERIAL NOT NULL,
    "source" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "name" TEXT,
    "brand" TEXT,
    "category" TEXT,
    "subcategory" TEXT,
    "year" INTEGER,
    "make" TEXT,
    "model" TEXT,
    "vin" TEXT,
    "description" TEXT,
    "odometer" TEXT,
    "odometer_miles" INTEGER,
    "price_cents" INTEGER,
    "bid_now" BOOLEAN NOT NULL DEFAULT false,
    "buy_it_now" BOOLEAN NOT NULL DEFAULT false,
    "pure_sale" BOOLEAN NOT NULL DEFAULT false,
    "auctions" BOOLEAN NOT NULL DEFAULT false,
    "primary_damage" TEXT,
    "body_style" TEXT,
    "engine" TEXT,
    "transmission" TEXT,
    "drivetrain" TEXT,
    "fuel" TEXT,
    "color" TEXT,
    "location" TEXT,
    "sale_date" TIMESTAMPTZ(6),
    "highlights" TEXT,
    "specs" JSONB NOT NULL DEFAULT '{}',
    "first_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "scraped_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lot_images" (
    "id" SERIAL NOT NULL,
    "lot_id" INTEGER NOT NULL,
    "sort_order" INTEGER NOT NULL,
    "original" TEXT NOT NULL,
    "path" TEXT,
    "http_url" TEXT,
    "size_bytes" INTEGER,

    CONSTRAINT "lot_images_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "lots_make_model_idx" ON "lots"("make", "model");

-- CreateIndex
CREATE INDEX "lots_year_idx" ON "lots"("year");

-- CreateIndex
CREATE INDEX "lots_price_cents_idx" ON "lots"("price_cents");

-- CreateIndex
CREATE INDEX "lots_sale_date_idx" ON "lots"("sale_date");

-- CreateIndex
CREATE INDEX "lots_scraped_at_idx" ON "lots"("scraped_at" DESC);

-- CreateIndex
CREATE INDEX "lots_vin_idx" ON "lots"("vin");

-- CreateIndex
CREATE UNIQUE INDEX "lots_source_source_id_key" ON "lots"("source", "source_id");

-- CreateIndex
CREATE INDEX "lot_images_lot_id_sort_order_idx" ON "lot_images"("lot_id", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "lot_images_lot_id_original_key" ON "lot_images"("lot_id", "original");

-- AddForeignKey
ALTER TABLE "lot_images" ADD CONSTRAINT "lot_images_lot_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "lots"("id") ON DELETE CASCADE ON UPDATE CASCADE;
