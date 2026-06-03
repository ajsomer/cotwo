import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import {
  sessions as sessionsT,
  sessionParticipants,
  appointments as appointmentsT,
  patientPhoneNumbers,
} from '@/lib/db/schema';
import { eq, sql } from 'drizzle-orm';
import { broadcastSessionChange } from '@/lib/realtime/broadcast';
import { resolveEntryTokenScope } from '@/lib/patient/entry-token';
import { assertPatientInOrg } from '@/lib/auth/staff-access';
import { findMatchingAppointmentForRoom } from '@/lib/patient/match-appointment';

const TERMINAL_SESSION_STATUSES = ['complete', 'done'];

/** Cap the match-then-validate retry loop. More than this many stale/abandoned
 *  candidates in one arrival (pathological concurrency only) falls through to
 *  on-demand — a deliberate, bounded degradation. */
const MAX_MATCH_ATTEMPTS = 3;

interface ArriveResponse {
  session_id: string;
  entry_token: string | null;
  status: string;
  /** True when this claim created the session (vs. reused an existing one).
   *  Drives whether we broadcast session_created or arrived. Stripped before
   *  the HTTP response. */
  created: boolean;
}

/**
 * POST /api/patient/arrive
 * Transitions a session to 'waiting' (telehealth) or 'checked_in' (in-person).
 * For on-demand entries (room link token, no session yet), creates the session.
 *
 * Session/room/location all come from the entry token — never caller-supplied
 * ids — so a patient can only arrive into the session/room their token names.
 * Any patient_id supplied must belong to the token's org.
 */
/**
 * Try to claim a matched appointment for an arriving patient, inside a single
 * transaction. Locks the appointment row, re-validates the match against the
 * locked state (the helper matched it outside the lock), then reuses or creates
 * the appointment's session, links/repairs the participant, and backfills the
 * appointment's patient_id.
 *
 * Returns the response on success, or null to signal "abandon this candidate"
 * (revalidation failed, or a participant-ownership conflict we can't safely
 * resolve) so the caller excludes it and re-matches.
 */
async function tryClaimAppointment(params: {
  appointmentId: string;
  patientId: string;
  roomId: string;
  locationId: string;
  deviceTested: boolean;
}): Promise<ArriveResponse | null> {
  const { appointmentId, patientId, roomId, locationId, deviceTested } = params;
  const nowIso = new Date().toISOString();

  return db.transaction(async (tx): Promise<ArriveResponse | null> => {
    // Lock the appointment row so concurrent arrivals serialise here — there is
    // no unique constraint on sessions.appointment_id, only an index.
    const [appt] = await tx
      .select({
        id: appointmentsT.id,
        patient_id: appointmentsT.patientId,
        status: appointmentsT.status,
        phone_number: appointmentsT.phoneNumber,
      })
      .from(appointmentsT)
      .where(eq(appointmentsT.id, appointmentId))
      .for('update')
      .limit(1);

    if (!appt) return null;

    // Re-validate against the locked row. Still terminal-free, and still ours:
    // either linked to this patient, or unlinked with a phone we own.
    if (['cancelled', 'completed', 'no_show'].includes(appt.status)) return null;
    const ownedViaLink = appt.patient_id === patientId;
    if (!ownedViaLink) {
      if (appt.patient_id !== null) return null; // linked to someone else
      // Unlinked: confirm the raw phone is still one of this patient's numbers.
      const phoneRows = await tx
        .select({ phone_number: patientPhoneNumbers.phoneNumber })
        .from(patientPhoneNumbers)
        .where(eq(patientPhoneNumbers.patientId, patientId));
      const phones = phoneRows.map((r) => r.phone_number);
      if (!appt.phone_number || !phones.includes(appt.phone_number)) return null;
    }

    // Find any existing session for the appointment, active-first.
    const [existing] = await tx
      .select({ id: sessionsT.id, entry_token: sessionsT.entryToken, status: sessionsT.status })
      .from(sessionsT)
      .where(eq(sessionsT.appointmentId, appointmentId))
      .orderBy(
        sql`(${sessionsT.status} in ('queued','waiting','checked_in','in_session')) desc`,
        sql`${sessionsT.createdAt} desc`,
      )
      .limit(1);

    let sessionId: string;
    let entryToken: string | null;
    let responseStatus: string;
    const created = !existing;
    const isTerminal = existing ? TERMINAL_SESSION_STATUSES.includes(existing.status) : false;

    if (!existing) {
      // No session at all: create one carrying the appointment + its room.
      const [inserted] = await tx
        .insert(sessionsT)
        .values({
          appointmentId,
          roomId,
          locationId,
          status: 'waiting',
          patientArrived: true,
          patientArrivedAt: nowIso,
          deviceTested,
        })
        .returning({ id: sessionsT.id, entry_token: sessionsT.entryToken });
      sessionId = inserted.id;
      entryToken = inserted.entry_token;
      responseStatus = 'waiting';
    } else {
      sessionId = existing.id;
      entryToken = existing.entry_token;
      switch (existing.status) {
        case 'queued':
          await tx
            .update(sessionsT)
            .set({
              status: 'waiting',
              patientArrived: true,
              patientArrivedAt: nowIso,
              prepCompleted: true,
              deviceTested,
            })
            .where(eq(sessionsT.id, sessionId));
          responseStatus = 'waiting';
          break;
        case 'waiting':
          // No-op re-entry.
          responseStatus = 'waiting';
          break;
        case 'checked_in':
          // In-person active session: ensure arrived flags, don't downgrade.
          await tx
            .update(sessionsT)
            .set({ patientArrived: true, patientArrivedAt: nowIso })
            .where(eq(sessionsT.id, sessionId));
          responseStatus = 'checked_in';
          break;
        case 'in_session':
          // Live call — rejoin, no downgrade.
          responseStatus = 'in_session';
          break;
        default:
          // complete / done — terminal, return real status untouched.
          responseStatus = existing.status;
          break;
      }
    }

    // Backfill the appointment's patient_id on both paths — it links the
    // appointment (not session history) and is correct regardless of state.
    if (appt.patient_id === null) {
      await tx.update(appointmentsT).set({ patientId }).where(eq(appointmentsT.id, appointmentId));
    }

    // Terminal sessions are historical: never mutate participants (and they
    // won't mint a video token anyway). Skip linking/repair.
    if (!isTerminal) {
      const participants = await tx
        .select({ patient_id: sessionParticipants.patientId })
        .from(sessionParticipants)
        .where(eq(sessionParticipants.sessionId, sessionId));

      const hasMe = participants.some((p) => p.patient_id === patientId);
      const others = participants.filter((p) => p.patient_id !== patientId);

      if (participants.length === 0) {
        await tx.insert(sessionParticipants).values({ sessionId, patientId, role: 'patient' });
      } else if (!hasMe && others.length > 0) {
        // A different patient owns the session's identity. Only repair if the
        // appointment is definitively linked to the arriving patient.
        if (ownedViaLink) {
          await tx
            .delete(sessionParticipants)
            .where(eq(sessionParticipants.sessionId, sessionId));
          await tx.insert(sessionParticipants).values({ sessionId, patientId, role: 'patient' });
        } else {
          // Can't prove ownership — abort the transaction and abandon this
          // candidate rather than hand back a foreign-identity session.
          throw new ParticipantConflictAbort();
        }
      }
      // hasMe with no conflicting others: already linked, nothing to do.
    }

    return { session_id: sessionId, entry_token: entryToken, status: responseStatus, created };
  }).catch((err) => {
    if (err instanceof ParticipantConflictAbort) return null;
    throw err;
  });
}

/** Sentinel used to roll back a claim transaction on an unresolvable
 *  participant-ownership conflict, signalling the caller to abandon the
 *  candidate (vs. a real error, which propagates). */
class ParticipantConflictAbort extends Error {}

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

  // On-demand entry (room link token, no session yet).
  if (!sessionId && scope.roomId) {
    // First, try to map the patient onto a scheduled appointment in this room
    // today (matched by phone). Bounded match-then-validate loop: a candidate
    // that goes stale between matching and locking is excluded and we re-match,
    // so a second still-valid appointment isn't skipped.
    if (body.patient_id) {
      const tried: string[] = [];
      const deviceTested = body.device_tested || false;
      for (let attempt = 0; attempt < MAX_MATCH_ATTEMPTS; attempt++) {
        const candidate = await findMatchingAppointmentForRoom({
          patientId: body.patient_id,
          roomId: scope.roomId,
          locationId: scope.locationId,
          excludeAppointmentIds: tried,
        });
        if (!candidate) break;

        const claimed = await tryClaimAppointment({
          appointmentId: candidate.appointmentId,
          patientId: body.patient_id,
          roomId: scope.roomId,
          locationId: scope.locationId,
          deviceTested,
        });

        if (claimed) {
          await broadcastSessionChange(
            scope.locationId,
            claimed.created ? 'session_created' : 'arrived',
            { session_id: claimed.session_id },
          );
          return NextResponse.json({
            session_id: claimed.session_id,
            entry_token: claimed.entry_token,
            status: claimed.status,
          });
        }
        // Revalidation / participant conflict: exclude and retry.
        tried.push(candidate.appointmentId);
      }
    }

    // No matching appointment (or all candidates abandoned): create a plain
    // on-demand session using the token's room + location.
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
