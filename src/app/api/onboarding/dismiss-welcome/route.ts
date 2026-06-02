import { getAuthenticatedUserId } from "@/lib/auth/staff-access";
import { createServiceClient } from "@/lib/supabase/service";
import { NextResponse } from "next/server";

export async function POST() {
  const userId = await getAuthenticatedUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const service = createServiceClient();

  await service
    .from("users")
    .update({ has_seen_patient_journey: true })
    .eq("id", userId);

  return NextResponse.json({ ok: true });
}
