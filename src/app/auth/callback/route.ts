import { createClient } from "@/lib/supabase/server";
import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const token_hash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const redirectUrl = request.nextUrl.clone();

  if (!token_hash || !type) {
    redirectUrl.pathname = "/login";
    redirectUrl.searchParams.set("error", "invalid_link");
    return NextResponse.redirect(redirectUrl);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ token_hash, type });

  if (error) {
    redirectUrl.pathname = "/login";
    redirectUrl.searchParams.set("error", "invalid_link");
    return NextResponse.redirect(redirectUrl);
  }

  // Clear search params for clean redirect
  redirectUrl.search = "";

  if (type === "recovery") {
    redirectUrl.pathname = "/auth/reset-password";
  } else {
    redirectUrl.pathname = "/runsheet";
  }

  return NextResponse.redirect(redirectUrl);
}
