import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";

// GET /api/files/view/[token] — validate delivery token, return signed URL + metadata
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;

  if (!token) {
    return NextResponse.json({ error: "Token required" }, { status: 400 });
  }

  try {
    const supabase = createServiceClient();

    // Look up the delivery by token
    const { data: delivery, error: deliveryError } = await supabase
      .from("file_deliveries")
      .select("id, file_id, viewed_at")
      .eq("token", token)
      .single();

    if (deliveryError || !delivery) {
      return NextResponse.json(
        { error: "This link is no longer available" },
        { status: 404 }
      );
    }

    // Get file details (archived files are still viewable via delivery links)
    const { data: file, error: fileError } = await supabase
      .from("files")
      .select("id, name, storage_path, file_size_bytes, mime_type, org_id")
      .eq("id", delivery.file_id)
      .single();

    if (fileError || !file) {
      return NextResponse.json(
        { error: "File not found" },
        { status: 404 }
      );
    }

    // Get org branding
    const { data: org } = await supabase
      .from("organisations")
      .select("name, logo_url")
      .eq("id", file.org_id)
      .single();

    // Generate short-lived signed URL (60 minutes)
    const { data: signedUrlData, error: signedUrlError } = await supabase.storage
      .from("clinic-files")
      .createSignedUrl(file.storage_path, 3600); // 60 minutes

    if (signedUrlError || !signedUrlData) {
      console.error("[files/view] Signed URL error:", signedUrlError);
      return NextResponse.json(
        { error: "Failed to generate file access" },
        { status: 500 }
      );
    }

    // Set viewed_at on first access
    if (!delivery.viewed_at) {
      await supabase
        .from("file_deliveries")
        .update({ viewed_at: new Date().toISOString() })
        .eq("id", delivery.id);
    }

    return NextResponse.json({
      file: {
        name: file.name,
        size_bytes: file.file_size_bytes,
        mime_type: file.mime_type,
        signed_url: signedUrlData.signedUrl,
      },
      org: org ? { name: org.name, logo_url: org.logo_url } : null,
    });
  } catch (err) {
    console.error("[files/view] Error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
