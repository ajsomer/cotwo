import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { resolveEntryTokenScope } from '@/lib/patient/entry-token';
import { assertPatientInOrg } from '@/lib/auth/staff-access';

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
  const body = await request.json();
  const { token, phone_number } = body;

  if (!token || !phone_number) {
    return NextResponse.json({ error: 'token and phone_number are required' }, { status: 400 });
  }

  const supabase = createServiceClient();

  const scope = await resolveEntryTokenScope(supabase, token);
  if (!scope) {
    return NextResponse.json({ error: 'Invalid token' }, { status: 404 });
  }
  const orgId = scope.orgId;
  const sessionId = scope.sessionId;

  let patientId: string;

  if (body.existing_patient_id) {
    // Mode 1: Confirm existing patient — must belong to the token's org.
    if (!(await assertPatientInOrg(supabase, body.existing_patient_id, orgId))) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    patientId = body.existing_patient_id;
  } else {
    // Mode 2: Create new patient
    const { first_name, last_name, date_of_birth } = body;

    if (!first_name || !last_name) {
      return NextResponse.json({ error: 'First name and last name are required' }, { status: 400 });
    }

    const { data: patient, error: patientError } = await supabase
      .from('patients')
      .insert({
        org_id: orgId,
        first_name,
        last_name,
        date_of_birth: date_of_birth || null,
      })
      .select('id')
      .single();

    if (patientError) {
      console.error('[IDENTITY] Failed to create patient:', patientError);
      return NextResponse.json({ error: 'Failed to create patient' }, { status: 500 });
    }

    patientId = patient.id;

    // Link phone number to new patient
    await supabase.from('patient_phone_numbers').insert({
      patient_id: patientId,
      phone_number,
      is_primary: true,
      verified_at: new Date().toISOString(),
    });
  }

  // Link patient to session (if the token resolved to one)
  if (sessionId) {
    // Remove any existing participant link first (idempotent)
    await supabase
      .from('session_participants')
      .delete()
      .eq('session_id', sessionId);

    const { error: linkError } = await supabase
      .from('session_participants')
      .insert({
        session_id: sessionId,
        patient_id: patientId,
        role: 'patient',
      });

    if (linkError) {
      console.error('[IDENTITY] Failed to link patient to session:', linkError);
    }

    // Also update the appointment's patient_id if it exists
    const { data: session } = await supabase
      .from('sessions')
      .select('appointment_id')
      .eq('id', sessionId)
      .single();

    if (session?.appointment_id) {
      await supabase
        .from('appointments')
        .update({ patient_id: patientId })
        .eq('id', session.appointment_id);
    }
  }

  // Fetch the full patient for return
  const { data: patient } = await supabase
    .from('patients')
    .select('id, first_name, last_name, date_of_birth')
    .eq('id', patientId)
    .single();

  return NextResponse.json({ patient });
}
