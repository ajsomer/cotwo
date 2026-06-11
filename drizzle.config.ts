import { defineConfig } from "drizzle-kit";

// Drizzle config for the Neon (Sydney) Postgres database.
//
// Migration workflow (read before reaching for drizzle-kit generate/migrate):
// - The TypeScript schema is INTROSPECTED from the live DB with
//   `drizzle-kit pull`, not authored by hand, so it matches exactly.
// - Schema changes are applied as hand-written SQL via the Neon MCP
//   (see memory/project_neon_migrations.md), then re-introspected.
// - `drizzle-kit generate`/`migrate` are NOT part of the workflow; there is
//   no drizzle-kit journal. SQL files under `out` are a historical record of
//   what was applied, not a replayable migration chain.
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/lib/db/schema.ts",
  out: "./src/lib/db/migrations",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
  // Only manage the public schema — neon_auth is owned by Neon Auth.
  schemaFilter: ["public"],
  verbose: true,
  strict: true,
});
