import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';

/**
 * POST /api/intake/[token]/verify
 *
 * Confirm-mode identity resolution. The clinic provides identity at
 * add-patient time, so the journey row already has a patient_id. The
 * patient's job here is to prove they control the phone number the clinic
 * assigned against.
 *
 * Request body:
 *   { phone_number: string, selected_patient_id?: string }
 *
 * Responses:
 *   { status: 'matched',      contact: { id, first_name, last_name } }
 *   { status: 'multi_match',  contacts: [{ id, first_name, last_name }, ...] }
 *   { status: 'no_match' }      — clinic data-entry error. No capture path.
 *
 * When `selected_patient_id` is passed (after a picker choice), we skip
 * resolution and attach that patient to the journey.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const body = await request.json();
  const { phone_number, selected_patient_id } = body as {
    phone_number?: string;
    selected_patient_id?: string;
  };

  if (!phone_number) {
    return NextResponse.json(
      { error: 'phone_number is required' },
      { status: 400 }
    );
  }

  const supabase = createServiceClient();

  // Resolve journey + org context
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

  // Fast path: picker selection. Attach the selected contact and return.
  if (selected_patient_id) {
    const { data: contact } = await supabase
      .from('patients')
      .select('id, first_name, last_name')
      .eq('id', selected_patient_id)
      .eq('org_id', orgId)
      .single();

    if (!contact) {
      return NextResponse.json({ status: 'no_match' });
    }

    await supabase
      .from('intake_package_journeys')
      .update({ patient_id: contact.id })
      .eq('id', journey.id);

    return NextResponse.json({ status: 'matched', contact });
  }

  // Resolve contacts for this phone number within this org.
  const { data: phoneLinks } = await supabase
    .from('patient_phone_numbers')
    .select('patient_id, patients!inner (id, first_name, last_name, org_id)')
    .eq('phone_number', phone_number)
    .eq('patients.org_id', orgId);

  type PhoneLink = {
    patient_id: string;
    patients: { id: string; first_name: string; last_name: string; org_id: string };
  };
  const links = (phoneLinks ?? []) as unknown as PhoneLink[];
  const contacts = links.map((l) => ({
    id: l.patients.id,
    first_name: l.patients.first_name,
    last_name: l.patients.last_name,
  }));

  if (contacts.length === 0) {
    return NextResponse.json({ status: 'no_match' });
  }

  if (contacts.length > 1) {
    return NextResponse.json({ status: 'multi_match', contacts });
  }

  // Single match: attach to journey and return.
  const contact = contacts[0];
  await supabase
    .from('intake_package_journeys')
    .update({ patient_id: contact.id })
    .eq('id', journey.id);

  return NextResponse.json({ status: 'matched', contact });
}
