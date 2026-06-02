import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { sessions as sessionsT, sessionParticipants } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
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

  if (!body.token) {
    return NextResponse.json({ error: 'token required' }, { status: 400 });
  }

  const scope = await resolveEntryTokenScope(body.token);
  if (!scope) {
    return NextResponse.json({ error: 'Invalid token' }, { status: 404 });
  }

  if (body.patient_id && !(await assertPatientInOrg(body.patient_id, scope.orgId))) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  let sessionId = scope.sessionId;

  // On-demand entry (room link token, no session yet): create the session
  // using the token's room + location.
  if (!sessionId && scope.roomId) {
    let newSession: { id: string; entry_token: string | null };
    try {
      [newSession] = await db
        .insert(sessionsT)
        .values({
          roomId: scope.roomId,
          locationId: scope.locationId,
          status: 'waiting',
          patientArrived: true,
          patientArrivedAt: new Date().toISOString(),
        })
        .returning({ id: sessionsT.id, entry_token: sessionsT.entryToken });
    } catch (sessionError) {
      console.error('[ARRIVE] Failed to create on-demand session:', sessionError);
      return NextResponse.json({ error: 'Failed to create session' }, { status: 500 });
    }

    sessionId = newSession.id;

    // Link patient to session
    if (body.patient_id) {
      await db.insert(sessionParticipants).values({
        sessionId,
        patientId: body.patient_id,
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

  let updated: { location_id: string };
  try {
    [updated] = await db
      .update(sessionsT)
      .set({
        status: newStatus,
        patientArrived: true,
        patientArrivedAt: new Date().toISOString(),
        prepCompleted: true,
        deviceTested: body.device_tested || false,
      })
      .where(eq(sessionsT.id, sessionId))
      .returning({ location_id: sessionsT.locationId });
  } catch (error) {
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
