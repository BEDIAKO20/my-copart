import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.js";

// A second PrismaClient pointed at ARCHIVE_DATABASE_URL — the "other database"
// that `npm run db:archive` copies the primary database into before clearing
// it. Kept separate from src/db/prisma.ts (the primary client) so an ordinary
// crawl never opens this connection.
let client: PrismaClient | null = null;

export function isArchiveDbConfigured(): boolean {
    return Boolean(process.env.ARCHIVE_DATABASE_URL?.trim());
}

export function getArchivePrisma(): PrismaClient {
    if (client) return client;

    const connectionString = process.env.ARCHIVE_DATABASE_URL?.trim();
    if (!connectionString) {
        throw new Error(
            "ARCHIVE_DATABASE_URL is not set. Add it to .env — see .env.example — " +
                "pointing at the second Postgres database you want old data moved into."
        );
    }

    const adapter = new PrismaPg({
        connectionString,
        max: 5,
        idleTimeoutMillis: 30_000,
        connectionTimeoutMillis: 15_000,
    });

    client = new PrismaClient({ adapter });
    return client;
}

export async function disconnectArchivePrisma(): Promise<void> {
    if (!client) return;
    await client.$disconnect();
    client = null;
}
