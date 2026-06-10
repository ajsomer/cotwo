import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import {
  intakePackageJourneys,
  appointments as appointmentsT,
  patients as patientsT,
  patientPhoneNumbers,
} from '@/lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { normalisePhone } from '@/lib/phone/normalise';
import { parseJsonBody } from '@/lib/api/route-helpers';

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
  const parsed = await parseJsonBody<{
    phone_number?: string;
    selected_patient_id?: string;
  }>(request);
  if (!parsed.ok) return parsed.response;
  const { phone_number, selected_patient_id } = parsed.body;

  if (!phone_number) {
    return NextResponse.json(
      { error: 'phone_number is required' },
      { status: 400 }
    );
  }

  // Resolve journey + org context (org via the appointment, inner join).
  const [journey] = await db
    .select({
      id: intakePackageJourneys.id,
      appointment_id: intakePackageJourneys.appointmentId,
      patient_id: intakePackageJourneys.patientId,
      org_id: appointmentsT.orgId,
    })
    .from(intakePackageJourneys)
    .innerJoin(
      appointmentsT,
      eq(appointmentsT.id, intakePackageJourneys.appointmentId)
    )
    .where(eq(intakePackageJourneys.journeyToken, token));

  if (!journey) {
    return NextResponse.json({ error: 'Journey not found' }, { status: 404 });
  }

  const orgId = journey.org_id;

  // Fast path: picker selection. Attach the selected contact and return.
  if (selected_patient_id) {
    const [contact] = await db
      .select({
        id: patientsT.id,
        first_name: patientsT.firstName,
        last_name: patientsT.lastName,
      })
      .from(patientsT)
      .where(
        and(eq(patientsT.id, selected_patient_id), eq(patientsT.orgId, orgId))
      );

    if (!contact) {
      return NextResponse.json({ status: 'no_match' });
    }

    await db
      .update(intakePackageJourneys)
      .set({ patientId: contact.id })
      .where(eq(intakePackageJourneys.id, journey.id));

    return NextResponse.json({ status: 'matched', contact });
  }

  // Resolve contacts for this phone number within this org. Match on the
  // canonical E.164 form so it lines up with how the number was stored.
  const matchPhone = normalisePhone(phone_number) ?? phone_number;
  const links = await db
    .select({
      id: patientsT.id,
      first_name: patientsT.firstName,
      last_name: patientsT.lastName,
    })
    .from(patientPhoneNumbers)
    .innerJoin(patientsT, eq(patientsT.id, patientPhoneNumbers.patientId))
    .where(
      and(
        eq(patientPhoneNumbers.phoneNumber, matchPhone),
        eq(patientsT.orgId, orgId)
      )
    );

  const contacts = links.map((l) => ({
    id: l.id,
    first_name: l.first_name,
    last_name: l.last_name,
  }));

  if (contacts.length === 0) {
    return NextResponse.json({ status: 'no_match' });
  }

  if (contacts.length > 1) {
    return NextResponse.json({ status: 'multi_match', contacts });
  }

  // Single match: attach to journey and return.
  const contact = contacts[0];
  await db
    .update(intakePackageJourneys)
    .set({ patientId: contact.id })
    .where(eq(intakePackageJourneys.id, journey.id));

  return NextResponse.json({ status: 'matched', contact });
}
