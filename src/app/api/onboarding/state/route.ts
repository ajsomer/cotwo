import { NextResponse } from "next/server";
import { requireAuthenticatedUser } from "@/lib/auth/staff-access";
import { createServiceClient } from "@/lib/supabase/service";
import type { OnboardingState } from "@/stores/clinic-store";

// GET /api/onboarding/state
// Returns the calling user's OnboardingState. Used by RunsheetShell on cold
// load to hydrate the onboarding slice client-side (replaces the SSR fetch
// that used to run in /runsheet/page.tsx).
export async function GET() {
  const auth = await requireAuthenticatedUser();
  if (!auth.ok) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const service = createServiceClient();

  const { data: userRow } = await service
    .from("users")
    .select("onboarding_stage, has_seen_patient_journey")
    .eq("id", auth.userId)
    .single();

  const stage = (userRow?.onboarding_stage ?? "not_started") as OnboardingState["stage"];
  const hasSeenPatientJourney = userRow?.has_seen_patient_journey ?? false;

  // Resolve the demo session ID (if one exists) so the coach mark can track it.
  let testSessionId: string | null = null;
  if (stage !== "not_started") {
    const { data: sa } = await service
      .from("staff_assignments")
      .select("location_id")
      .eq("user_id", auth.userId)
      .limit(1)
      .maybeSingle();

    if (sa?.location_id) {
      const { data: demoSession } = await service
        .from("sessions")
        .select("id")
        .eq("location_id", sa.location_id)
        .eq("is_onboarding_demo", true)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      testSessionId = demoSession?.id ?? null;
    }
  }

  const state: OnboardingState = {
    stage,
    testSessionId,
    hasSeenPatientJourney,
    coachMarkDismissed: {},
  };

  return NextResponse.json(state);
}
