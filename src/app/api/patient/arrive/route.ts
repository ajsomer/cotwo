import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { broadcastSessionChange } from '@/lib/realtime/broadcast';
import { resolveEntryTokenScope } from '@/lib/patient/entry-token';
import { assertPatientInOrg } from '@/lib/auth/staff-access';

/**
 * POST /api/patient/arrive
 * Transitions a session to 'waiting' (telehealth) or 'checked_in' (in-person).
 * For on-demand entries (room link token, no session yet), creates the session.
 *
 * Session/room/location all come from the entry token — never caller-supplied
 * ids — so a patient can only arrive into the session/room their token names.
 * Any patient_id supplied must belong to the token's org.
 */
export async function POST(request: NextRequest) {
  const body = await request.json();
  const supabase = createServiceClient();

  if (!body.token) {
    return NextResponse.json({ error: 'token required' }, { status: 400 });
  }

  const scope = await resolveEntryTokenScope(supabase, body.token);
  if (!scope) {
    return NextResponse.json({ error: 'Invalid token' }, { status: 404 });
  }

  if (body.patient_id && !(await assertPatientInOrg(supabase, body.patient_id, scope.orgId))) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  let sessionId = scope.sessionId;

  // On-demand entry (room link token, no session yet): create the session
  // using the token's room + location.
  if (!sessionId && scope.roomId) {
    const { data: newSession, error: sessionError } = await supabase
      .from('sessions')
      .insert({
        room_id: scope.roomId,
        location_id: scope.locationId,
        status: 'waiting',
        patient_arrived: true,
        patient_arrived_at: new Date().toISOString(),
      })
      .select('id, entry_token')
      .single();

    if (sessionError) {
      console.error('[ARRIVE] Failed to create on-demand session:', sessionError);
      return NextResponse.json({ error: 'Failed to create session' }, { status: 500 });
    }

    sessionId = newSession.id;

    // Link patient to session
    if (body.patient_id) {
      await supabase.from('session_participants').insert({
        session_id: sessionId,
        patient_id: body.patient_id,
        role: 'patient',
      });
    }

    await broadcastSessionChange(scope.locationId, 'session_created', {
      session_id: sessionId,
    });

    return NextResponse.json({
      session_id: sessionId,
      entry_token: newSession.entry_token,
      status: 'waiting',
    });
  }

  // No session and no room to create one from.
  if (!sessionId) {
    return NextResponse.json({ error: 'Token does not resolve to a session' }, { status: 400 });
  }

  const modality = body.modality || 'telehealth';
  const newStatus = modality === 'in_person' ? 'checked_in' : 'waiting';

  const { data: updated, error } = await supabase
    .from('sessions')
    .update({
      status: newStatus,
      patient_arrived: true,
      patient_arrived_at: new Date().toISOString(),
      prep_completed: true,
      device_tested: body.device_tested || false,
    })
    .eq('id', sessionId)
    .select('location_id')
    .single();

  if (error) {
    console.error('[ARRIVE] Failed to update session:', error);
    return NextResponse.json({ error: 'Failed to update session' }, { status: 500 });
  }

  if (updated?.location_id) {
    await broadcastSessionChange(updated.location_id, 'arrived', {
      session_id: sessionId,
    });
  }

  return NextResponse.json({
    session_id: sessionId,
    status: newStatus,
  });
}
