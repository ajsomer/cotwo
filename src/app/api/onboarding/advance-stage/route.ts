import { getAuthenticatedUserId } from "@/lib/auth/staff-access";
import { db } from "@/lib/db";
import { users as usersT } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";

const STAGE_ORDER = ["not_started", "test_session_sent", "call_active", "call_completed"] as const;
type OnboardingStage = (typeof STAGE_ORDER)[number];

export async function POST(request: NextRequest) {
  const userId = await getAuthenticatedUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const { to } = body as { to?: OnboardingStage };

  if (to !== "call_active" && to !== "call_completed") {
    return NextResponse.json({ error: "Invalid stage." }, { status: 400 });
  }

  const [userRecord] = await db
    .select({ onboarding_stage: usersT.onboardingStage })
    .from(usersT)
    .where(eq(usersT.id, userId))
    .limit(1);

  const currentStage = userRecord?.onboarding_stage as OnboardingStage | undefined;
  const currentIndex = currentStage ? STAGE_ORDER.indexOf(currentStage) : 0;
  const targetIndex = STAGE_ORDER.indexOf(to);

  // Never go backward
  if (targetIndex <= currentIndex) {
    return NextResponse.json({ ok: true, stage: currentStage });
  }

  await db.update(usersT).set({ onboardingStage: to }).where(eq(usersT.id, userId));

  return NextResponse.json({ ok: true, stage: to });
}
