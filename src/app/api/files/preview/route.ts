import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireStaffOrgAccess } from "@/lib/auth/staff-access";
import { denyResponse } from "@/lib/api/route-helpers";

// GET /api/files/preview?storage_path=xxx — generate a short-lived signed URL for staff preview
export async function GET(request: NextRequest) {
  const storagePath = request.nextUrl.searchParams.get("storage_path");

  if (!storagePath) {
    return NextResponse.json({ error: "storage_path required" }, { status: 400 });
  }

  // storage_path is `${orgId}/${fileId}.pdf` — gate on the org prefix so a
  // caller can only preview files in an org they staff at.
  const orgId = storagePath.split("/")[0];
  if (!orgId) {
    return NextResponse.json({ error: "Invalid storage_path" }, { status: 400 });
  }

  const supabase = createServiceClient();

  const access = await requireStaffOrgAccess(orgId);
  if (!access.ok) {
    return denyResponse(access);
  }

  try {
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
