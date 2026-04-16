import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { broadcastSessionChange } from '@/lib/realtime/broadcast';

/**
 * POST /api/patient/arrive
 * Transitions a session to 'waiting' (telehealth) or 'checked_in' (in-person).
 * For on-demand entries, creates the session first.
 */
export async function POST(request: NextRequest) {
  const body = await request.json();
  const supabase = createServiceClient();

  let sessionId = body.session_id;

  // On-demand entry: create session now
  if (!sessionId && body.room_id && body.location_id) {
    const { data: newSession, error: sessionError } = await supabase
      .from('sessions')
      .insert({
        room_id: body.room_id,
        location_id: body.location_id,
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

    await broadcastSessionChange(body.location_id, 'session_created', {
      session_id: sessionId,
    });

    return NextResponse.json({
      session_id: sessionId,
      entry_token: newSession.entry_token,
      status: 'waiting',
    });
  }

  // Existing session: transition to waiting/checked_in
  if (!sessionId) {
    return NextResponse.json({ error: 'session_id or room_id + location_id required' }, { status: 400 });
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
