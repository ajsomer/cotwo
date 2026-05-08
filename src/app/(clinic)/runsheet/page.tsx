import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { RunsheetShell } from "@/components/clinic/runsheet-shell";
import { OnboardingHydrator } from "@/components/clinic/onboarding-hydrator";
import type { OnboardingState } from "@/stores/clinic-store";

async function getOnboardingState(userId: string): Promise<OnboardingState> {
  const service = createServiceClient();

  const { data: userRow } = await service
    .from("users")
    .select("onboarding_stage, has_seen_patient_journey")
    .eq("id", userId)
    .single();

  const stage = (userRow?.onboarding_stage ?? "not_started") as OnboardingState["stage"];
  const hasSeenPatientJourney = userRow?.has_seen_patient_journey ?? false;

  // If a demo session was already created, find it so the coach mark can track it
  let testSessionId: string | null = null;
  if (stage !== "not_started") {
    const { data: sa } = await service
      .from("staff_assignments")
      .select("location_id")
      .eq("user_id", userId)
      .limit(1)
      .single();

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

  return {
    stage,
    testSessionId,
    hasSeenPatientJourney,
    coachMarkDismissed: {},
  };
}

export default async function RunSheetPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const onboarding = user ? await getOnboardingState(user.id) : null;

  return (
    <>
      {onboarding && <OnboardingHydrator state={onboarding} />}
      <RunsheetShell />
    </>
  );
}
