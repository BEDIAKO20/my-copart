/**
 * Applies the same Prisma migrations to the ARCHIVE database that already ran
 * against the primary one, so `npm run db:archive` has somewhere to copy rows
 * into. Run this once (and again after any future schema change).
 *
 *   npm run db:archive:setup
 */
import "dotenv/config";
import { execSync } from "node:child_process";

const archiveDirectUrl = process.env.ARCHIVE_DIRECT_URL?.trim();

if (!archiveDirectUrl) {
    console.error(
        "ARCHIVE_DIRECT_URL is not set. Add it to .env — see .env.example — with " +
            "the archive database's DIRECT (non-pooled) connection string."
    );
    process.exit(1);
}

console.log("Applying migrations to the archive database...");
try {
    execSync("npx prisma migrate deploy", {
        stdio: "inherit",
        // Prisma Migrate reads DIRECT_URL via prisma.config.ts. Overriding it
        // only in this child process — rather than editing .env — means the
        // primary DIRECT_URL is never touched, so nothing else can accidentally
        // end up pointed at the archive database.
        env: { ...process.env, DIRECT_URL: archiveDirectUrl },
    });
    console.log("Archive database schema is up to date.");
} catch {
    console.error("Migration failed — see the output above.");
    process.exit(1);
}
