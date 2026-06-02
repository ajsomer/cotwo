import { defineConfig } from "drizzle-kit";

// Drizzle config for the Neon (Sydney) Postgres database.
// `schema` is the generated TypeScript schema; `out` holds drizzle-kit
// migration artifacts. We introspect the live DB with `drizzle-kit pull`
// rather than authoring the schema by hand, so it matches exactly.
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
