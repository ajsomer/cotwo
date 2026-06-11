import { getAuthenticatedUserId } from "@/lib/auth/staff-access";
import { db } from "@/lib/db";
import { users as usersT } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { unauthenticatedResponse } from "@/lib/api/route-helpers";

export async function POST() {
  const userId = await getAuthenticatedUserId();
  if (!userId) return unauthenticatedResponse();

  await db
    .update(usersT)
    .set({ hasSeenPatientJourney: true })
    .where(eq(usersT.id, userId));

  return NextResponse.json({ ok: true });
}
