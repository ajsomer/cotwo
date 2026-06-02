/**
 * Resolve a Neon Auth user id from a raw cookie header, OUTSIDE a Next request
 * scope.
 *
 * The Socket.IO server (server.ts) runs under tsx, not the Next App Router.
 * `auth.getSession()` from @/lib/auth/neon-auth can't be used here: its local
 * fast path reads cookies via `next/headers` `cookies()`, which throws
 * "`cookies` was called outside a request scope" when called from the socket
 * handshake. Passing `fetchOptions.headers` doesn't help — that only affects
 * the upstream fallback, not the local cookie read.
 *
 * So we do what the SDK's own upstream fallback does, directly: forward the
 * handshake cookie header to the Neon Auth server's `/get-session` endpoint and
 * read the validated user from the response. The auth server verifies the
 * session token; we never trust the cookie's contents ourselves. No
 * next/headers, no unexported SDK internals — just the documented HTTP endpoint
 * and NEON_AUTH_BASE_URL.
 *
 * Returns the user id, or null if there's no valid session.
 */
export async function resolveSocketUserId(
  cookieHeader: string,
): Promise<string | null> {
  if (!cookieHeader || !cookieHeader.includes("neon-auth")) return null;

  const baseUrl = process.env.NEON_AUTH_BASE_URL;
  if (!baseUrl) return null;

  const url = `${baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl}/get-session`;

  try {
    const response = await fetch(url, {
      headers: { Cookie: cookieHeader },
      // Match the SDK's own timeout on this call so a slow/hung auth server
      // can't stall the socket handshake.
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) return null;

    const body = (await response.json()) as
      | { user?: { id?: string } | null }
      | null;
    return body?.user?.id ?? null;
  } catch {
    // Network error / timeout / bad JSON → treat as unauthenticated. The
    // caller leaves the socket anonymous, which only loses access to staff
    // rooms (patient flows are unaffected).
    return null;
  }
}
