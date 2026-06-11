import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { db } from "@/lib/db";
import { files as filesT } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { fetchFiles } from "@/lib/clinic/fetchers/forms";
import {
  requireStaffOrgAccess,
  requireStaffCanAccessFile,
} from "@/lib/auth/staff-access";
import { denyResponse } from "@/lib/api/route-helpers";

// GET /api/files?org_id=xxx — list active files for an org
export async function GET(request: NextRequest) {
  const orgId = request.nextUrl.searchParams.get("org_id");

  if (!orgId) {
    return NextResponse.json({ error: "org_id required" }, { status: 400 });
  }

  const access = await requireStaffOrgAccess(orgId);
  if (!access.ok) {
    return denyResponse(access);
  }

  try {
    const files = await fetchFiles(orgId);
    return NextResponse.json({ files });
  } catch (err) {
    console.error("[files] GET error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// POST /api/files — upload file (multipart form data)
export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const orgId = formData.get("org_id") as string | null;
    const name = formData.get("name") as string | null;
    const description = formData.get("description") as string | null;
    const uploadedBy = formData.get("uploaded_by") as string | null;

    if (!file || !orgId || !name) {
      return NextResponse.json(
        { error: "file, org_id, and name are required" },
        { status: 400 }
      );
    }

    if (file.type !== "application/pdf") {
      return NextResponse.json(
        { error: "Only PDF files are accepted" },
        { status: 400 }
      );
    }

    if (file.size > 10 * 1024 * 1024) {
      return NextResponse.json(
        { error: "File must be under 10 MB" },
        { status: 400 }
      );
    }

    const supabase = createServiceClient();

    const access = await requireStaffOrgAccess(orgId);
    if (!access.ok) {
      return denyResponse(access);
    }

    const fileId = crypto.randomUUID();
    const storagePath = `${orgId}/${fileId}.pdf`;

    // Upload to Supabase Storage
    const arrayBuffer = await file.arrayBuffer();
    const { error: uploadError } = await supabase.storage
      .from("clinic-files")
      .upload(storagePath, arrayBuffer, {
        contentType: "application/pdf",
        upsert: false,
      });

    if (uploadError) {
      console.error("[files] Storage upload error:", uploadError);
      return NextResponse.json(
        { error: "Failed to upload file: " + uploadError.message },
        { status: 500 }
      );
    }

    // Create files row
    let fileRow;
    try {
      [fileRow] = await db
        .insert(filesT)
        .values({
          id: fileId,
          orgId,
          name: name.trim(),
          description: description?.trim() || null,
          storagePath,
          fileSizeBytes: file.size,
          mimeType: "application/pdf",
          uploadedBy: uploadedBy || null,
        })
        .returning({
          id: filesT.id,
          org_id: filesT.orgId,
          name: filesT.name,
          description: filesT.description,
          storage_path: filesT.storagePath,
          file_size_bytes: filesT.fileSizeBytes,
          mime_type: filesT.mimeType,
          uploaded_by: filesT.uploadedBy,
          archived_at: filesT.archivedAt,
          created_at: filesT.createdAt,
        });
    } catch (dbError) {
      console.error("[files] DB insert error:", dbError);
      // Clean up the uploaded storage object
      await supabase.storage.from("clinic-files").remove([storagePath]);
      return NextResponse.json({ error: (dbError as Error).message }, { status: 500 });
    }

    return NextResponse.json({ file: fileRow }, { status: 201 });
  } catch (err) {
    console.error("[files] POST error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// DELETE /api/files?id=xxx — soft-delete (set archived_at)
export async function DELETE(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("id");

  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  try {
    const supabase = createServiceClient();

    const access = await requireStaffCanAccessFile(id);
    if (!access.ok) {
      return denyResponse(access);
    }

    await db
      .update(filesT)
      .set({ archivedAt: new Date().toISOString() })
      .where(eq(filesT.id, id));

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[files] DELETE error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
