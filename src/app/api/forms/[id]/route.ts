import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { forms as formsT } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { requireStaffCanAccessForm } from "@/lib/auth/staff-access";
import { denyResponse } from "@/lib/api/route-helpers";

// GET /api/forms/[id]
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const access = await requireStaffCanAccessForm(id);
  if (!access.ok) {
    return denyResponse(access);
  }

  try {
    const [form] = await db
      .select({
        id: formsT.id,
        org_id: formsT.orgId,
        name: formsT.name,
        description: formsT.description,
        schema: formsT.schema,
        status: formsT.status,
        is_platform_demo: formsT.isPlatformDemo,
        public_token: formsT.publicToken,
        public_token_rotated_at: formsT.publicTokenRotatedAt,
        public_token_rotated_by: formsT.publicTokenRotatedBy,
        created_at: formsT.createdAt,
        updated_at: formsT.updatedAt,
      })
      .from(formsT)
      .where(eq(formsT.id, id));

    if (!form) {
      return NextResponse.json({ error: "Form not found" }, { status: 404 });
    }

    return NextResponse.json({ form });
  } catch (err) {
    console.error("[Forms] GET /api/forms/[id] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
