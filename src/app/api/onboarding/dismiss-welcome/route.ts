import { getAuthenticatedUserId } from "@/lib/auth/staff-access";
import { db } from "@/lib/db";
import { users as usersT } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

export async function POST() {
  const userId = await getAuthenticatedUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await db
    .update(usersT)
    .set({ hasSeenPatientJourney: true })
    .where(eq(usersT.id, userId));

  return NextResponse.json({ ok: true });
}
