import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.js";

// Built lazily so the crawler still runs (writing only local JSON) when
// DATABASE_URL isn't set.
let client: PrismaClient | null = null;

export function isDbConfigured(): boolean {
    return Boolean(process.env.DATABASE_URL?.trim());
}

export function getPrisma(): PrismaClient {
    if (client) return client;

    const connectionString = process.env.DATABASE_URL?.trim();
    if (!connectionString) {
        throw new Error(
            "DATABASE_URL is not set. Copy .env.example to .env and paste your Neon connection string."
        );
    }

    // Prisma 7 requires a driver adapter; PrismaPg wraps node-postgres. The app
    // uses the POOLED Neon endpoint here — migrations use DIRECT_URL instead,
    // configured in prisma.config.ts.
    const adapter = new PrismaPg({
        connectionString,
        max: 5,
        // Neon idles compute out, so don't hold dead sockets open.
        idleTimeoutMillis: 30_000,
        connectionTimeoutMillis: 15_000,
    });

    client = new PrismaClient({ adapter });
    return client;
}

export async function disconnectPrisma(): Promise<void> {
    if (!client) return;
    await client.$disconnect();
    client = null;
}
