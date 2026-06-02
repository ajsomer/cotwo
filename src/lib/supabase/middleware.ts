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
function hasSessionCookie(request: NextRequest): boolean {
  // Neon Auth (Better Auth) session cookies are prefixed; match defensively.
  return request.cookies
    .getAll()
    .some(
      (c) =>
        (c.name.includes("session") || c.name.includes("auth")) &&
        !!c.value &&
        c.value.length > 0,
    );
}

export async function updateSession(request: NextRequest) {
  const response = NextResponse.next({ request });
  const pathname = request.nextUrl.pathname;

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
