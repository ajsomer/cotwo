import { createNeonAuth } from "@neondatabase/auth/next/server";

// Neon Auth server instance (staff authentication).
//
// Replaces Supabase Auth. Users/sessions live in the `neon_auth` schema in the
// same Neon (Sydney) database — so auth is in-region too, no cross-region hop.
// The session is verified locally from a signed cookie (no per-request round
// trip to the auth server in the common case — see sessionDataTtl caching).
//
// Identity contract: the Neon Auth user id (session.user.id) is used directly
// as `public.users.id`. On staff sign-up the app must INSERT the matching
// public.users row (there is no DB trigger doing it — see signup flow).
export const auth = createNeonAuth({
  baseUrl: process.env.NEON_AUTH_BASE_URL!,
  cookies: {
    secret: process.env.NEON_AUTH_COOKIE_SECRET!,
    // sameSite 'lax' so the session cookie survives the OAuth/redirect
    // navigations the app uses; prototype runs same-site anyway.
    sameSite: "lax",
  },
});
