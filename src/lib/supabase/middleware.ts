import { NextResponse, type NextRequest } from "next/server";

// Routes that never require auth
const PUBLIC_ROUTES = ["/entry", "/waiting", "/intake", "/auth/callback"];

// Routes that handle their own auth — skip the gate
const API_ROUTES_PREFIX = "/api/";

// Routes that should redirect away if already authenticated
const AUTH_ROUTES = ["/login", "/signup"];

function isPublicRoute(pathname: string) {
  return PUBLIC_ROUTES.some((r) => pathname === r || pathname.startsWith(r + "/"));
}

function isAuthRoute(pathname: string) {
  return AUTH_ROUTES.includes(pathname);
}

// Neon Auth stores its session in a signed cookie. The middleware runs on the
// Edge runtime, where neither the `pg` driver nor the Neon Auth Node SDK can
// run — so we do a CHEAP presence check here (is there a session cookie?) and
// let the server components (clinic layout, setup pages — all Node runtime with
// DB access) do the AUTHORITATIVE auth + setup-state gating and redirects.
//
// Prototype: cookie-presence is a coarse gate, not a security boundary. The
// real checks (valid session, org/role, setup completeness) happen server-side
// where the DB and Neon Auth SDK are available.
// The exact Neon Auth (Better Auth) session-token cookie name. Mirrors the
// SDK's own internal presence check (NEON_AUTH_COOKIE_PREFIX + ".session_token",
// see @neondatabase/auth). Matching the EXACT name — not a loose
// includes("session")/includes("auth") substring — is what stops unrelated
// cookies from reading as "authed" and bouncing the user into a redirect loop.
const SESSION_COOKIE_NAME = "__Secure-neon-auth.session_token";

// All Neon Auth cookies share this prefix (session_token + local.session_data).
// Used to clear a stale session wholesale when the server rejects it.
const AUTH_COOKIE_PREFIX = "__Secure-neon-auth";

function hasSessionCookie(request: NextRequest): boolean {
  const c = request.cookies.get(SESSION_COOKIE_NAME);
  return !!c?.value;
}

// Clears every Neon Auth cookie on the given response. Called when a stale
// session must be invalidated — a Server Component can't modify cookies (Next.js
// only allows that in middleware / Server Actions / Route Handlers), so the
// clinic layout signals the loop-break via ?clear-session and we do it here.
function clearAuthCookies(request: NextRequest, response: NextResponse) {
  for (const c of request.cookies.getAll()) {
    if (c.name.startsWith(AUTH_COOKIE_PREFIX)) {
      response.cookies.delete(c.name);
    }
  }
}

export async function updateSession(request: NextRequest) {
  const response = NextResponse.next({ request });
  const pathname = request.nextUrl.pathname;

  // Loop-breaker: the clinic layout rejected a present-but-invalid session and
  // redirected here. Clear the stale cookies so the next request reads as
  // unauthed and /login renders normally — instead of bouncing back to /runsheet.
  if (request.nextUrl.searchParams.has("clear-session")) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.delete("clear-session");
    const redirectRes = NextResponse.redirect(url);
    clearAuthCookies(request, redirectRes);
    return redirectRes;
  }

  // Public + API routes: no gating here.
  if (isPublicRoute(pathname) || pathname.startsWith(API_ROUTES_PREFIX)) {
    return response;
  }

  const authed = hasSessionCookie(request);

  // Already authed and on /login or /signup → send to the app. The clinic
  // layout / setup pages will route to the correct setup step.
  if (isAuthRoute(pathname)) {
    if (authed) {
      const url = request.nextUrl.clone();
      url.pathname = "/runsheet";
      return NextResponse.redirect(url);
    }
    return response;
  }

  // Everything else requires a session cookie. No cookie → /login. (Server
  // components re-verify the session for real and handle setup-step routing.)
  if (!authed) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  return response;
}
