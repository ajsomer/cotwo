import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";

// Routes that never require auth
const PUBLIC_ROUTES = ["/entry", "/waiting", "/auth/callback"];

// Routes that handle their own auth — skip setup gate
const API_ROUTES_PREFIX = "/api/";

// Routes that should redirect to setup/runsheet if already authenticated
const AUTH_ROUTES = ["/login", "/signup"];

// Setup routes in prerequisite order
const SETUP_ROUTES = ["/setup/clinic", "/setup/rooms"];

function isPublicRoute(pathname: string) {
  return PUBLIC_ROUTES.some(
    (r) => pathname === r || pathname.startsWith(r + "/")
  );
}

function isAuthRoute(pathname: string) {
  return AUTH_ROUTES.includes(pathname);
}

function isSetupRoute(pathname: string) {
  return SETUP_ROUTES.some(
    (r) => pathname === r || pathname.startsWith(r + "/")
  );
}

type SetupState = "no_org" | "no_rooms" | "complete";

async function getSetupState(userId: string): Promise<SetupState> {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data: assignments } = await supabase
    .from("staff_assignments")
    .select("id, location_id")
    .eq("user_id", userId)
    .limit(1);

  const assignment = assignments?.[0];

  console.log("[middleware] getSetupState userId:", userId, "assignments:", assignments?.length ?? 0);

  if (!assignment) return "no_org";

  const { count } = await supabase
    .from("rooms")
    .select("id", { count: "exact", head: true })
    .eq("location_id", assignment.location_id);

  if (!count || count === 0) return "no_rooms";

  return "complete";
}

function redirectForState(state: SetupState): string {
  switch (state) {
    case "no_org":
      return "/setup/clinic";
    case "no_rooms":
      return "/setup/rooms";
    case "complete":
      return "/runsheet";
  }
}

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const pathname = request.nextUrl.pathname;

  // Public routes — no auth needed
  if (isPublicRoute(pathname)) {
    return supabaseResponse;
  }

  // API routes handle their own auth
  if (pathname.startsWith(API_ROUTES_PREFIX)) {
    return supabaseResponse;
  }

  // Validate JWT and refresh tokens
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Auth routes (/login, /signup) — redirect away if already authenticated
  if (isAuthRoute(pathname)) {
    if (user) {
      const state = await getSetupState(user.id);
      const url = request.nextUrl.clone();
      url.pathname = redirectForState(state);
      return NextResponse.redirect(url);
    }
    return supabaseResponse;
  }

  // Everything below requires auth
  if (!user) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  // Setup routes — enforce prerequisite chain
  if (isSetupRoute(pathname)) {
    const state = await getSetupState(user.id);

    if (pathname.startsWith("/setup/clinic") && state !== "no_org") {
      const url = request.nextUrl.clone();
      url.pathname = state === "no_rooms" ? "/setup/rooms" : "/runsheet";
      return NextResponse.redirect(url);
    }

    if (pathname.startsWith("/setup/rooms")) {
      if (state === "no_org") {
        const url = request.nextUrl.clone();
        url.pathname = "/setup/clinic";
        return NextResponse.redirect(url);
      }
      if (state === "complete") {
        const url = request.nextUrl.clone();
        url.pathname = "/runsheet";
        return NextResponse.redirect(url);
      }
    }

    return supabaseResponse;
  }

  // Reset password — just needs auth (already checked above)
  if (pathname === "/auth/reset-password") {
    return supabaseResponse;
  }

  // All clinic routes — require complete setup
  const state = await getSetupState(user.id);
  if (state !== "complete") {
    const url = request.nextUrl.clone();
    url.pathname = redirectForState(state);
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}
