import { NextResponse } from "next/server";
import { requireAuthenticatedUser } from "@/lib/auth/staff-access";
import { db } from "@/lib/db";
import {
  users as usersT,
  staffAssignments,
  sessions as sessionsT,
} from "@/lib/db/schema";
import { and, desc, eq } from "drizzle-orm";
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

  const [userRow] = await db
    .select({
      onboarding_stage: usersT.onboardingStage,
      has_seen_patient_journey: usersT.hasSeenPatientJourney,
    })
    .from(usersT)
    .where(eq(usersT.id, auth.userId))
    .limit(1);

  const stage = (userRow?.onboarding_stage ?? "not_started") as OnboardingState["stage"];
  const hasSeenPatientJourney = userRow?.has_seen_patient_journey ?? false;

  // Resolve the demo session ID (if one exists) so the coach mark can track it.
  let testSessionId: string | null = null;
  if (stage !== "not_started") {
    const [sa] = await db
      .select({ location_id: staffAssignments.locationId })
      .from(staffAssignments)
      .where(eq(staffAssignments.userId, auth.userId))
      .limit(1);

    if (sa?.location_id) {
      const [demoSession] = await db
        .select({ id: sessionsT.id })
        .from(sessionsT)
        .where(
          and(
            eq(sessionsT.locationId, sa.location_id),
            eq(sessionsT.isOnboardingDemo, true),
          ),
        )
        .orderBy(desc(sessionsT.createdAt))
        .limit(1);

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
