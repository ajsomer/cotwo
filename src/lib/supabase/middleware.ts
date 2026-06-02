import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";

// Routes that never require auth
const PUBLIC_ROUTES = ["/entry", "/waiting", "/intake", "/auth/callback"];

// Routes that handle their own auth — skip setup gate
const API_ROUTES_PREFIX = "/api/";

// Routes that should redirect to setup/runsheet if already authenticated
const AUTH_ROUTES = ["/login", "/signup"];

// Setup routes in prerequisite order
const SETUP_ROUTES = ["/setup/clinic", "/setup/pms", "/setup/rooms", "/setup/payments"];

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

type SetupState = "no_org" | "no_pms" | "no_rooms" | "no_payments" | "complete";

async function getSetupState(userId: string): Promise<SetupState> {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data: assignments } = await supabase
    .from("staff_assignments")
    .select("id, location_id, locations!inner(org_id)")
    .eq("user_id", userId)
    .limit(1);

  const assignment = assignments?.[0] as
    | { id: string; location_id: string; locations: { org_id: string } }
    | undefined;

  if (!assignment) return "no_org";

  const orgId = assignment.locations.org_id;

  const { count: pmsCount } = await supabase
    .from("pms_connections")
    .select("id", { count: "exact", head: true })
    .eq("org_id", orgId);

  if (!pmsCount || pmsCount === 0) return "no_pms";

  const { count: roomCount } = await supabase
    .from("rooms")
    .select("id", { count: "exact", head: true })
    .eq("location_id", assignment.location_id);

  if (!roomCount || roomCount === 0) return "no_rooms";

  const { count: stripeCount } = await supabase
    .from("stripe_connections")
    .select("id", { count: "exact", head: true })
    .eq("org_id", orgId);

  if (!stripeCount || stripeCount === 0) return "no_payments";

  return "complete";
}

function redirectForState(state: SetupState): string {
  switch (state) {
    case "no_org":
      return "/setup/clinic";
    case "no_pms":
      return "/setup/pms";
    case "no_rooms":
      return "/setup/rooms";
    case "no_payments":
      return "/setup/payments";
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
    const redirect = (to: string) => {
      const url = request.nextUrl.clone();
      url.pathname = to;
      return NextResponse.redirect(url);
    };

    // Setup pages enforce ordering (can't skip ahead) and bounce to runsheet
    // when setup is complete. They do NOT auto-skip when their own data is
    // populated — Gentu pre-populates rooms but the user still gets to review
    // them, and the connected PMS card stays visible with a Continue button.
    if (pathname.startsWith("/setup/clinic")) {
      if (state !== "no_org") return redirect(redirectForState(state));
    } else if (pathname.startsWith("/setup/pms")) {
      if (state === "no_org") return redirect("/setup/clinic");
      if (state === "complete") return redirect("/runsheet");
    } else if (pathname.startsWith("/setup/rooms")) {
      if (state === "no_org") return redirect("/setup/clinic");
      if (state === "no_pms") return redirect("/setup/pms");
      if (state === "complete") return redirect("/runsheet");
    } else if (pathname.startsWith("/setup/payments")) {
      if (state === "no_org") return redirect("/setup/clinic");
      if (state === "no_pms") return redirect("/setup/pms");
      if (state === "no_rooms") return redirect("/setup/rooms");
      if (state === "complete") return redirect("/runsheet");
    }

    return supabaseResponse;
  }

  // Reset password — just needs auth (already checked above)
  if (pathname === "/auth/reset-password") {
    return supabaseResponse;
  }

  // All clinic routes — require complete setup.
  // Performance cache: skip the 2 DB queries if we already verified recently.
  // This cookie is a performance hint only — the JWT validation above is the
  // actual security boundary. Do not promote this cookie to a security check.
  const setupCookie = request.cookies.get("x-setup-complete")?.value;
  if (setupCookie === "1") {
    return supabaseResponse;
  }

  const state = await getSetupState(user.id);
  if (state !== "complete") {
    const url = request.nextUrl.clone();
    url.pathname = redirectForState(state);
    return NextResponse.redirect(url);
  }

  // Setup verified — cache for 5 minutes to skip DB queries on subsequent navigations
  supabaseResponse.cookies.set("x-setup-complete", "1", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 300,
    path: "/",
  });

  return supabaseResponse;
}
