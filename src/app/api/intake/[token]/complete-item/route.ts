import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import {
  intakePackageJourneys,
  formSubmissions,
  appointmentActions,
  appointments as appointmentsT,
} from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { broadcastReadinessChange, broadcastSessionChange } from '@/lib/realtime/broadcast';
import { fireActionNow } from '@/lib/workflows/engine';
import { findAppointmentActionsByType } from '@/lib/workflows/queries';
import { getBaseUrl } from '@/lib/utils/url';
import { parseJsonBody } from '@/lib/api/route-helpers';

type ItemType = 'card' | 'consent' | 'form';

/**
 * POST /api/intake/[token]/complete-item
 * Marks a single intake item as complete on intake_package_journeys.
 * Body: { item_type: 'card' | 'consent' | 'form', form_id?: string, data?: any }
 *
 * When all configured items are complete, flips the journey status to
 * 'completed' and marks the corresponding appointment_actions row for the
 * intake_package action block as completed.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const parsed = await parseJsonBody<{
    item_type: ItemType;
    form_id?: string;
    data?: unknown;
  }>(request);
  if (!parsed.ok) return parsed.response;
  const { item_type, form_id, data } = parsed.body;

  if (!item_type) {
    return NextResponse.json({ error: 'item_type is required' }, { status: 400 });
  }

  let journey;
  try {
    [journey] = await db
      .select({
        id: intakePackageJourneys.id,
        appointment_id: intakePackageJourneys.appointmentId,
        patient_id: intakePackageJourneys.patientId,
        status: intakePackageJourneys.status,
        includes_card_capture: intakePackageJourneys.includesCardCapture,
        includes_consent: intakePackageJourneys.includesConsent,
        form_ids: intakePackageJourneys.formIds,
        card_captured_at: intakePackageJourneys.cardCapturedAt,
        consent_completed_at: intakePackageJourneys.consentCompletedAt,
        forms_completed: intakePackageJourneys.formsCompleted,
      })
      .from(intakePackageJourneys)
      .where(eq(intakePackageJourneys.journeyToken, token))
      .limit(1);
  } catch {
    journey = undefined;
  }

  if (!journey) {
    return NextResponse.json({ error: 'Journey not found' }, { status: 404 });
  }

  if (journey.status === 'completed') {
    return NextResponse.json({
      journey: journey,
      already_completed: true,
    });
  }

  const now = new Date().toISOString();
  const updates: Record<string, unknown> = {};

  if (item_type === 'card') {
    updates.cardCapturedAt = now;
  } else if (item_type === 'consent') {
    updates.consentCompletedAt = now;
  } else if (item_type === 'form') {
    if (!form_id) {
      return NextResponse.json(
        { error: 'form_id is required for form completion' },
        { status: 400 }
      );
    }

    // Record the form completion timestamp in the JSONB map
    const existing = (journey.forms_completed as Record<string, string>) ?? {};
    updates.formsCompleted = { ...existing, [form_id]: now };

    // Create form_submissions row so the clinic sees the answers (best-effort)
    if (journey.patient_id && data) {
      await db.insert(formSubmissions).values({
        formId: form_id,
        patientId: journey.patient_id,
        appointmentId: journey.appointment_id,
        responses: data,
      });
    }
  } else {
    return NextResponse.json(
      { error: `Unknown item_type: ${item_type}` },
      { status: 400 }
    );
  }

  let updated;
  try {
    [updated] = await db
      .update(intakePackageJourneys)
      .set(updates)
      .where(eq(intakePackageJourneys.id, journey.id))
      .returning({
        id: intakePackageJourneys.id,
        status: intakePackageJourneys.status,
        card_captured_at: intakePackageJourneys.cardCapturedAt,
        consent_completed_at: intakePackageJourneys.consentCompletedAt,
        forms_completed: intakePackageJourneys.formsCompleted,
        includes_card_capture: intakePackageJourneys.includesCardCapture,
        includes_consent: intakePackageJourneys.includesConsent,
        form_ids: intakePackageJourneys.formIds,
      });
  } catch (updateErr) {
    console.error('[INTAKE COMPLETE-ITEM] update failed:', updateErr);
    return NextResponse.json({ error: 'Failed to update journey' }, { status: 500 });
  }

  if (!updated) {
    console.error('[INTAKE COMPLETE-ITEM] update returned no row');
    return NextResponse.json({ error: 'Failed to update journey' }, { status: 500 });
  }

  // Check whether all configured items are now done
  const allDone = isJourneyComplete(updated);

  // Testing convenience: the URL we hand back to the client so the patient
  // tab can log its next join link to the devtools console (see
  // intake-journey.tsx). Populated when add_to_runsheet fires.
  let sessionJoinUrl: string | null = null;

  if (allDone) {
    await db
      .update(intakePackageJourneys)
      .set({ status: 'completed', completedAt: new Date().toISOString() })
      .where(eq(intakePackageJourneys.id, journey.id));

    // Flip the matching intake_package appointment_action to completed
    await markIntakeActionCompleted(journey.appointment_id);

    // TESTING ONLY: fire add_to_runsheet immediately so the end-to-end flow
    // (intake → run sheet → waiting room) can be walked in one sitting. In
    // production this fires on its real scheduled offset via the workflow
    // engine cron. See TODO.md — remove once we have a dedicated test fixture.
    const runsheetToken = await fireAddToRunsheetEarly(journey.appointment_id);
    if (runsheetToken) {
      sessionJoinUrl = `${getBaseUrl()}/entry/${runsheetToken}`;
    }

    // Notify the readiness dashboard at this appointment's location.
    const [appt] = await db
      .select({ location_id: appointmentsT.locationId })
      .from(appointmentsT)
      .where(eq(appointmentsT.id, journey.appointment_id))
      .limit(1);
    if (appt?.location_id) {
      await broadcastReadinessChange(appt.location_id, 'package_completed', {
        appointment_id: journey.appointment_id,
      });
      if (runsheetToken) {
        // New session appeared — notify the run sheet too.
        await broadcastSessionChange(appt.location_id, 'session_created', {
          appointment_id: journey.appointment_id,
        });
      }
    }
  }

  const [finalJourney] = await db
    .select({
      id: intakePackageJourneys.id,
      journey_token: intakePackageJourneys.journeyToken,
      status: intakePackageJourneys.status,
      patient_id: intakePackageJourneys.patientId,
      includes_card_capture: intakePackageJourneys.includesCardCapture,
      includes_consent: intakePackageJourneys.includesConsent,
      form_ids: intakePackageJourneys.formIds,
      card_captured_at: intakePackageJourneys.cardCapturedAt,
      consent_completed_at: intakePackageJourneys.consentCompletedAt,
      forms_completed: intakePackageJourneys.formsCompleted,
    })
    .from(intakePackageJourneys)
    .where(eq(intakePackageJourneys.id, journey.id))
    .limit(1);

  return NextResponse.json({
    journey: finalJourney,
    completed: allDone,
    session_join_url: sessionJoinUrl,
  });
}

/**
 * Find this appointment's add_to_runsheet action and fire it immediately.
 * Returns the newly-minted session's entry_token if fired, null otherwise.
 * TESTING ONLY — see call site.
 */
async function fireAddToRunsheetEarly(
  appointmentId: string
): Promise<string | null> {
  const runsheetActions = await findAppointmentActionsByType(
    appointmentId,
    'add_to_runsheet'
  );
  const runsheetAction = runsheetActions.find((a) => a.status === 'scheduled');
  if (!runsheetAction) return null;

  // The patient is finishing intake in-app — they're about to be routed to the
  // waiting room, so skip the "join here" SMS. Sending it here is redundant and
  // (with a real provider) blocks this response on the SMS round-trip.
  const result = await fireActionNow(runsheetAction.id, {
    suppressNotification: true,
  });
  if (result.status !== 'fired') return null;
  return ((result.resultData as { entry_token?: string } | null)?.entry_token) ?? null;
}

function isJourneyComplete(j: {
  includes_card_capture: boolean;
  includes_consent: boolean;
  form_ids: string[];
  card_captured_at: string | null;
  consent_completed_at: string | null;
  forms_completed: unknown;
}): boolean {
  if (j.includes_card_capture && !j.card_captured_at) return false;
  if (j.includes_consent && !j.consent_completed_at) return false;

  const formsDone = (j.forms_completed as Record<string, string>) ?? {};
  for (const id of j.form_ids ?? []) {
    if (!formsDone[id]) return false;
  }

  return true;
}

async function markIntakeActionCompleted(appointmentId: string) {
  const [intakeAction] = await findAppointmentActionsByType(
    appointmentId,
    'intake_package'
  );

  if (!intakeAction) {
    console.warn(
      `[INTAKE COMPLETE-ITEM] No intake_package action found for appointment ${appointmentId}`
    );
    return;
  }

  if (intakeAction.status === 'completed') return;

  await db
    .update(appointmentActions)
    .set({
      status: 'completed',
      completedAt: new Date().toISOString(),
    })
    .where(eq(appointmentActions.id, intakeAction.id));
}
