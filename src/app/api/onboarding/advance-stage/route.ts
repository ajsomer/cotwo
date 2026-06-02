import { getAuthenticatedUserId } from "@/lib/auth/staff-access";
import { createServiceClient } from "@/lib/supabase/service";
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

  const service = createServiceClient();

  const { data: userRecord } = await service
    .from("users")
    .select("onboarding_stage")
    .eq("id", userId)
    .single();

  const currentStage = userRecord?.onboarding_stage as OnboardingStage | undefined;
  const currentIndex = currentStage ? STAGE_ORDER.indexOf(currentStage) : 0;
  const targetIndex = STAGE_ORDER.indexOf(to);

  // Never go backward
  if (targetIndex <= currentIndex) {
    return NextResponse.json({ ok: true, stage: currentStage });
  }

  await service
    .from("users")
    .update({ onboarding_stage: to })
    .eq("id", userId);

  return NextResponse.json({ ok: true, stage: to });
}
