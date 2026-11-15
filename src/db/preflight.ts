import { getPrisma } from "./prisma.js";
import type { PrismaClient } from "../generated/prisma/client.js";

/** Tables the write path needs. Checked before a crawl (or archive) starts. */
const REQUIRED_TABLES = [
    "products",
    "source",
    "category",
    "subcategory",
    "product_images",
    "current_bid",
    "spec",
] as const;

const REQUIRED_COLUMNS = [{ table: "current_bid", column: "sale_name" }] as const;

export interface PreflightInfo {
    host: string;
    database: string;
    user: string;
    schema: string;
}

export interface PreflightOptions {
    /** Which PrismaClient to check. Defaults to the primary (DATABASE_URL) client. */
    prisma?: PrismaClient;
    /** Connection string used only to report a hostname in messages. */
    connectionUrl?: string;
    /** Named in error messages, e.g. "primary" or "archive". */
    label?: string;
    /** Command suggested in the error when required tables are missing. */
    setupHint?: string;
}

/**
 * Verifies a database is reachable AND the schema exists, before any crawling
 * or archiving happens.
 *
 * Without this a missing schema is nearly invisible: every per-lot write fails,
 * gets logged among thousands of crawl lines, and the run still finishes
 * "successfully" with an empty database. Crawlee also purges local storage at
 * the start of each run, so a silently failed crawl loses the data entirely.
 *
 * Throws with a message saying exactly what to run.
 */
export async function assertDatabaseReady(options: PreflightOptions = {}): Promise<PreflightInfo> {
    const {
        prisma = getPrisma(),
        connectionUrl = process.env.DATABASE_URL,
        label = "primary",
        setupHint = "npm run db:deploy      (apply existing migrations)\n" +
            "  Or:        npm run db:migrate     (create a migration if you changed the schema)",
    } = options;

    let where: PreflightInfo;
    try {
        const rows = await prisma.$queryRaw<
            { database: string; usr: string; schema: string }[]
        >`SELECT current_database() AS database, current_user AS usr, current_schema() AS schema`;

        where = {
            host: hostFromUrl(connectionUrl),
            database: rows[0].database,
            user: rows[0].usr,
            schema: rows[0].schema ?? "public",
        };
    } catch (err) {
        throw new Error(
            `Cannot reach the ${label} database at ${hostFromUrl(connectionUrl)}: ` +
                `${(err as Error).message}\n` +
                `  Check its connection string in .env, and that the Neon project still exists.`
        );
    }

    const tables = await prisma.$queryRaw<{ tablename: string }[]>`
        SELECT tablename FROM pg_tables WHERE schemaname = current_schema()`;
    const present = new Set(tables.map((t) => t.tablename));
    const missing = REQUIRED_TABLES.filter((t) => !present.has(t));

    if (missing.length > 0) {
        throw new Error(
            `The ${label} database "${where.database}" (schema "${where.schema}") on ${where.host} ` +
                `is missing ${missing.length} of ${REQUIRED_TABLES.length} required tables: ` +
                `${missing.join(", ")}\n` +
                `  It currently has ${present.size} table(s).\n` +
                `  Fix with:  ${setupHint}`
        );
    }

    const columns = await prisma.$queryRaw<{ table_name: string; column_name: string }[]>`
        SELECT table_name, column_name
        FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'current_bid'
          AND column_name = 'sale_name'`;
    const presentColumns = new Set(columns.map(({ table_name, column_name }) => `${table_name}.${column_name}`));
    const missingColumns = REQUIRED_COLUMNS.filter(({ table, column }) => !presentColumns.has(`${table}.${column}`));

    if (missingColumns.length > 0) {
        throw new Error(
            `The ${label} database "${where.database}" (schema "${where.schema}") on ${where.host} ` +
                `is missing required column(s): ${missingColumns.map(({ table, column }) => `${table}.${column}`).join(", ")}\n` +
                `  Apply the additive schema change from ` +
                `prisma/migrations/20261110000000_add_sale_name_to_current_bid/migration.sql.`
        );
    }

    return where;
}

function hostFromUrl(url: string | undefined): string {
    if (!url) return "(connection string not set)";
    try {
        return new URL(url).hostname;
    } catch {
        return "(unparseable connection string)";
    }
}
