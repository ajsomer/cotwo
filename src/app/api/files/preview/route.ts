import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";

// GET /api/files/preview?storage_path=xxx — generate a short-lived signed URL for staff preview
export async function GET(request: NextRequest) {
  const storagePath = request.nextUrl.searchParams.get("storage_path");

  if (!storagePath) {
    return NextResponse.json({ error: "storage_path required" }, { status: 400 });
  }

  try {
    const supabase = createServiceClient();

    const { data, error } = await supabase.storage
      .from("clinic-files")
      .createSignedUrl(storagePath, 3600); // 60 minutes

    if (error || !data) {
      console.error("[files/preview] Signed URL error:", error);
      return NextResponse.json({ error: "Failed to generate preview" }, { status: 500 });
    }

    return NextResponse.json({ signed_url: data.signedUrl });
  } catch (err) {
    console.error("[files/preview] Error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
