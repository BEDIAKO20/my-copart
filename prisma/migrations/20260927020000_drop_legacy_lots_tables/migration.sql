-- Drops the legacy flat `lots` / `lot_images` tables. They were only ever
-- kept so `npm run db:backfill` could migrate old rows into the normalized
-- structure; both tables were confirmed empty (0 rows) before this ran, and
-- the backfill script + legacy normalizer have been removed along with them.

-- DropForeignKey
ALTER TABLE "lot_images" DROP CONSTRAINT "lot_images_lot_id_fkey";

-- DropTable
DROP TABLE "lot_images";

-- DropTable
DROP TABLE "lots";
