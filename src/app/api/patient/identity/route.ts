import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import {
  patients as patientsT,
  patientPhoneNumbers,
  sessionParticipants,
  sessions as sessionsT,
  appointments as appointmentsT,
} from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { resolveEntryTokenScope } from '@/lib/patient/entry-token';
import { assertPatientInOrg } from '@/lib/auth/staff-access';
import { normalisePhone } from '@/lib/phone/normalise';
import { parseJsonBody } from '@/lib/api/route-helpers';

/**
 * POST /api/patient/identity
 * Confirms or creates a patient identity and links them to the session.
 *
 * Two modes:
 * 1. existing_patient_id provided: confirm existing patient, link to session
 * 2. new patient data provided: create patient, link phone, link to session
 *
 * Scope is derived from the entry token, not caller-supplied: org and session
 * come from the token (an attacker can't create a patient in another org or
 * link to another patient's session), and an existing_patient_id must belong
 * to the token's org.
 */
export async function POST(request: NextRequest) {
  const parsed = await parseJsonBody<{
    token?: string;
    phone_number?: string;
    existing_patient_id?: string;
    first_name?: string;
    last_name?: string;
    date_of_birth?: string;
  }>(request);
  if (!parsed.ok) return parsed.response;
  const body = parsed.body;
  const { token, phone_number: rawPhone } = body;

  if (!token || !rawPhone) {
    return NextResponse.json({ error: 'token and phone_number are required' }, { status: 400 });
  }

  // Store the canonical E.164 form so this patient's number matches however it
  // was originally entered elsewhere (readiness, run sheet, PMS).
  const phone_number = normalisePhone(rawPhone);
  if (!phone_number) {
    return NextResponse.json({ error: 'Invalid phone number' }, { status: 400 });
  }

  const scope = await resolveEntryTokenScope(token);
  if (!scope) {
    return NextResponse.json({ error: 'Invalid token' }, { status: 404 });
  }
  const orgId = scope.orgId;
  const sessionId = scope.sessionId;

  let patientId: string;

  if (body.existing_patient_id) {
    // Mode 1: Confirm existing patient — must belong to the token's org.
    if (!(await assertPatientInOrg(body.existing_patient_id, orgId))) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    patientId = body.existing_patient_id;
  } else {
    // Mode 2: Create new patient
    const { first_name, last_name, date_of_birth } = body;

    if (!first_name || !last_name) {
      return NextResponse.json({ error: 'First name and last name are required' }, { status: 400 });
    }

    let patient: { id: string };
    try {
      [patient] = await db
        .insert(patientsT)
        .values({
          orgId,
          firstName: first_name,
          lastName: last_name,
          dateOfBirth: date_of_birth || null,
        })
        .returning({ id: patientsT.id });
    } catch (patientError) {
      console.error('[IDENTITY] Failed to create patient:', patientError);
      return NextResponse.json({ error: 'Failed to create patient' }, { status: 500 });
    }

    patientId = patient.id;

    // Link phone number to new patient
    await db.insert(patientPhoneNumbers).values({
      patientId,
      phoneNumber: phone_number,
      isPrimary: true,
      verifiedAt: new Date().toISOString(),
    });
  }

  // Link patient to session (if the token resolved to one)
  if (sessionId) {
    // Remove any existing participant link first (idempotent)
    await db
      .delete(sessionParticipants)
      .where(eq(sessionParticipants.sessionId, sessionId));

    try {
      await db.insert(sessionParticipants).values({
        sessionId,
        patientId,
        role: 'patient',
      });
    } catch (linkError) {
      console.error('[IDENTITY] Failed to link patient to session:', linkError);
    }

    // Also update the appointment's patient_id if it exists
    const [session] = await db
      .select({ appointment_id: sessionsT.appointmentId })
      .from(sessionsT)
      .where(eq(sessionsT.id, sessionId));

    if (session?.appointment_id) {
      await db
        .update(appointmentsT)
        .set({ patientId })
        .where(eq(appointmentsT.id, session.appointment_id));
    }
  }

  // Fetch the full patient for return
  const [patient] = await db
    .select({
      id: patientsT.id,
      first_name: patientsT.firstName,
      last_name: patientsT.lastName,
      date_of_birth: patientsT.dateOfBirth,
    })
    .from(patientsT)
    .where(eq(patientsT.id, patientId));

  return NextResponse.json({ patient });
}
