import "dotenv/config";
import { defineConfig, env } from "prisma/config";

export default defineConfig({
    schema: "prisma/schema.prisma",
    migrations: {
        path: "prisma/migrations",
    },
    datasource: {
        // The Prisma CLI (migrate/db) uses the DIRECT, non-pooled Neon endpoint:
        // schema changes need a real session, which the PgBouncer pooler can't
        // give. The app itself connects through the pooled DATABASE_URL — see
        // src/db/prisma.ts.
        url: env("DIRECT_URL"),
    },
});
