import { NextResponse, type NextRequest } from "next/server";

// Supabase Auth email-OTP / recovery-link callback used to live here. Neon Auth
// handles its own callbacks via /api/auth/[...path]. This prototype has no
// email-link flow, so any hit here just returns to login.
export async function GET(request: NextRequest) {
  const url = request.nextUrl.clone();
  url.search = "";
  url.pathname = "/login";
  return NextResponse.redirect(url);
}
