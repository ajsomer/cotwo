import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';

/**
 * POST /api/intake/[token]/verify
 * Resolves the journey's patient contact after phone OTP verification.
 *
 * Two modes (Phase 7 — capture mode):
 * 1. existing_patient_id provided: confirm existing contact, attach to journey.
 * 2. new patient data provided: create contact, link phone, attach to journey.
 *
 * The calling client verifies the OTP via /api/patient/otp/verify first, then
 * posts here to attach the verified contact to the journey.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const body = await request.json();
  const { phone_number, existing_patient_id, first_name, last_name, date_of_birth } = body;

  if (!phone_number) {
    return NextResponse.json(
      { error: 'phone_number is required' },
      { status: 400 }
    );
  }

  const supabase = createServiceClient();

  // Resolve journey + appointment + org
  const { data: journey } = await supabase
    .from('intake_package_journeys')
    .select('id, appointment_id, patient_id, appointments!inner (org_id)')
    .eq('journey_token', token)
    .single();

  if (!journey) {
    return NextResponse.json({ error: 'Journey not found' }, { status: 404 });
  }

  const orgId = (journey as unknown as { appointments: { org_id: string } })
    .appointments.org_id;
  let patientId: string;

  if (existing_patient_id) {
    // Confirm existing patient contact
    patientId = existing_patient_id;
  } else {
    if (!first_name || !last_name) {
      return NextResponse.json(
        { error: 'First name and last name are required' },
        { status: 400 }
      );
    }

    // Create new patient contact scoped to the journey's org
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

    if (patientError || !patient) {
      console.error('[INTAKE VERIFY] Failed to create patient:', patientError);
      return NextResponse.json(
        { error: 'Failed to create contact' },
        { status: 500 }
      );
    }

    patientId = patient.id;

    // Link phone to new contact
    await supabase.from('patient_phone_numbers').insert({
      patient_id: patientId,
      phone_number,
      is_primary: true,
      verified_at: new Date().toISOString(),
    });
  }

  // Attach verified patient to journey
  await supabase
    .from('intake_package_journeys')
    .update({ patient_id: patientId })
    .eq('id', journey.id);

  // If the appointment has no patient yet, backfill it (multi-contact: only if null)
  const { data: appointment } = await supabase
    .from('appointments')
    .select('patient_id')
    .eq('id', journey.appointment_id)
    .single();

  if (appointment && !appointment.patient_id) {
    await supabase
      .from('appointments')
      .update({ patient_id: patientId })
      .eq('id', journey.appointment_id);
  }

  // Return the patient for confirmation screen
  const { data: patient } = await supabase
    .from('patients')
    .select('id, first_name, last_name, date_of_birth')
    .eq('id', patientId)
    .single();

  return NextResponse.json({ patient });
}
