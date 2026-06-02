import { loadEnvConfig } from "@next/env";

// Populate process.env from .env.local / .env (same precedence Next.js uses)
// for the custom server (server.ts) and any tsx-run script.
//
// The Next.js App Router loads these automatically, but server.ts runs under
// bare `tsx` and its module scope evaluates BEFORE app.prepare() would load
// them. Modules imported by server.ts that read env at evaluation time —
// neon-auth (createNeonAuth needs NEON_AUTH_COOKIE_SECRET) and the db client
// (needs DATABASE_URL) — would otherwise throw on import. Importing this module
// FIRST, before any env-dependent import, guarantees the env is present.
//
// ESM evaluates imports in source order, so `import "@/lib/load-env"` placed
// above the env-dependent imports runs this side effect first.
loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production");
