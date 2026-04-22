import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { broadcastReadinessChange, broadcastSessionChange } from '@/lib/realtime/broadcast';
import { fireActionNow } from '@/lib/workflows/engine';
import { getBaseUrl } from '@/lib/utils/url';

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
  const body = await request.json();
  const { item_type, form_id, data } = body as {
    item_type: ItemType;
    form_id?: string;
    data?: unknown;
  };

  if (!item_type) {
    return NextResponse.json({ error: 'item_type is required' }, { status: 400 });
  }

  const supabase = createServiceClient();

  const { data: journey, error: journeyErr } = await supabase
    .from('intake_package_journeys')
    .select(
      `id, appointment_id, patient_id, status,
       includes_card_capture, includes_consent, form_ids,
       card_captured_at, consent_completed_at, forms_completed`
    )
    .eq('journey_token', token)
    .single();

  if (journeyErr || !journey) {
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
    updates.card_captured_at = now;
  } else if (item_type === 'consent') {
    updates.consent_completed_at = now;
  } else if (item_type === 'form') {
    if (!form_id) {
      return NextResponse.json(
        { error: 'form_id is required for form completion' },
        { status: 400 }
      );
    }

    // Record the form completion timestamp in the JSONB map
    const existing = (journey.forms_completed as Record<string, string>) ?? {};
    updates.forms_completed = { ...existing, [form_id]: now };

    // Create form_submissions row so the clinic sees the answers (best-effort)
    if (journey.patient_id && data) {
      await supabase.from('form_submissions').insert({
        form_id,
        patient_id: journey.patient_id,
        appointment_id: journey.appointment_id,
        responses: data,
      });
    }
  } else {
    return NextResponse.json(
      { error: `Unknown item_type: ${item_type}` },
      { status: 400 }
    );
  }

  const { data: updated, error: updateErr } = await supabase
    .from('intake_package_journeys')
    .update(updates)
    .eq('id', journey.id)
    .select(
      `id, status, card_captured_at, consent_completed_at, forms_completed,
       includes_card_capture, includes_consent, form_ids`
    )
    .single();

  if (updateErr || !updated) {
    console.error('[INTAKE COMPLETE-ITEM] update failed:', updateErr);
    return NextResponse.json({ error: 'Failed to update journey' }, { status: 500 });
  }

  // Check whether all configured items are now done
  const allDone = isJourneyComplete(updated);

  // Testing convenience: the URL we hand back to the client so the patient
  // tab can log its next join link to the devtools console (see
  // intake-journey.tsx). Populated when add_to_runsheet fires.
  let sessionJoinUrl: string | null = null;

  if (allDone) {
    await supabase
      .from('intake_package_journeys')
      .update({ status: 'completed', completed_at: new Date().toISOString() })
      .eq('id', journey.id);

    // Flip the matching intake_package appointment_action to completed
    await markIntakeActionCompleted(supabase, journey.appointment_id);

    // TESTING ONLY: fire add_to_runsheet immediately so the end-to-end flow
    // (intake → run sheet → waiting room) can be walked in one sitting. In
    // production this fires on its real scheduled offset via the workflow
    // engine cron. See TODO.md — remove once we have a dedicated test fixture.
    const runsheetToken = await fireAddToRunsheetEarly(
      supabase,
      journey.appointment_id
    );
    if (runsheetToken) {
      sessionJoinUrl = `${getBaseUrl()}/entry/${runsheetToken}`;
    }

    // Notify the readiness dashboard at this appointment's location.
    const { data: appt } = await supabase
      .from('appointments')
      .select('location_id')
      .eq('id', journey.appointment_id)
      .maybeSingle();
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

  const { data: finalJourney } = await supabase
    .from('intake_package_journeys')
    .select(
      `id, journey_token, status, patient_id,
       includes_card_capture, includes_consent, form_ids,
       card_captured_at, consent_completed_at, forms_completed`
    )
    .eq('id', journey.id)
    .single();

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
  supabase: ReturnType<typeof createServiceClient>,
  appointmentId: string
): Promise<string | null> {
  const { data: actions } = await supabase
    .from('appointment_actions')
    .select('id, action_block_id, status')
    .eq('appointment_id', appointmentId);
  if (!actions?.length) return null;

  const blockIds = actions.map((a) => a.action_block_id);
  const { data: blocks } = await supabase
    .from('workflow_action_blocks')
    .select('id, action_type')
    .in('id', blockIds);

  const runsheetBlockIds = new Set(
    (blocks ?? [])
      .filter((b) => b.action_type === 'add_to_runsheet')
      .map((b) => b.id)
  );
  const runsheetAction = actions.find(
    (a) => runsheetBlockIds.has(a.action_block_id) && a.status === 'scheduled'
  );
  if (!runsheetAction) return null;

  const result = await fireActionNow(runsheetAction.id);
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

async function markIntakeActionCompleted(
  supabase: ReturnType<typeof createServiceClient>,
  appointmentId: string
) {
  // Fetch all actions for this appointment and their action-block type in a
  // two-step query to avoid ambiguity around nested-row shape in joins.
  const { data: actions } = await supabase
    .from('appointment_actions')
    .select('id, action_block_id, status')
    .eq('appointment_id', appointmentId);

  if (!actions || actions.length === 0) return;

  const blockIds = actions.map((a) => a.action_block_id);
  const { data: blocks } = await supabase
    .from('workflow_action_blocks')
    .select('id, action_type')
    .in('id', blockIds);

  const intakeBlockIds = new Set(
    (blocks ?? [])
      .filter((b) => b.action_type === 'intake_package')
      .map((b) => b.id)
  );

  const intakeAction = actions.find((a) => intakeBlockIds.has(a.action_block_id));

  if (!intakeAction) {
    console.warn(
      `[INTAKE COMPLETE-ITEM] No intake_package action found for appointment ${appointmentId}`
    );
    return;
  }

  if (intakeAction.status === 'completed') return;

  await supabase
    .from('appointment_actions')
    .update({
      status: 'completed',
      completed_at: new Date().toISOString(),
    })
    .eq('id', intakeAction.id);
}
