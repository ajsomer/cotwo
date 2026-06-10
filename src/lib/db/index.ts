import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema";

// Pooled direct Postgres connection to Neon (Sydney).
//
// This replaces the Supabase JS client. The whole point of the migration:
// a reused, pooled connection means per-query overhead is sub-millisecond
// after warmup — no PostgREST/HTTP round-trip per call, no auth-server hop.
// The serial-waterfall query patterns in the app are no longer expensive.
//
// We use the `-pooler` host (PgBouncer) via DATABASE_URL. One Pool per
// server process, reused across requests. Authorization is enforced in app
// code (staff-access.ts gates) — RLS was dropped in the Neon migration, so
// this connection has full table access by design.

declare global {
  // Reuse the pool across HMR reloads in dev to avoid exhausting connections.
  // eslint-disable-next-line no-var
  var __coviuPgPool: Pool | undefined;
}

const pool =
  global.__coviuPgPool ??
  new Pool({
    connectionString: process.env.DATABASE_URL,
    // Neon pooler handles connection multiplexing; keep the client-side pool
    // modest. Neon requires TLS but its pooler presents a cert that doesn't
    // verify against the system CA, so we disable strict verification here
    // explicitly (rather than relying on the sslmode= URL param, whose
    // meaning is changing in pg v9). Prototype: encrypted transport without
    // CA pinning is fine.
    max: 10,
    ssl: { rejectUnauthorized: false },
  });

if (process.env.NODE_ENV !== "production") {
  global.__coviuPgPool = pool;
}

export const db = drizzle(pool, { schema });
export { schema };
