import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import {
  patients as patientsT,
  patientPhoneNumbers,
} from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { resolveEntryTokenScope } from '@/lib/patient/entry-token';
import { assertPatientInOrg } from '@/lib/auth/staff-access';
import { getTyroProviderForOrg } from '@/lib/payments';
import { resolvePatientRefId } from '@/lib/payments/ref-id';
import { getBaseUrl } from '@/lib/utils/url';

/**
 * POST /api/patient/card/tyro-token
 *
 * Starts the Tyro "request payment details" card-save flow (no charge) via REST.
 * Ensures the patient exists on Tyro under our refId, requests a hosted card-save
 * page, and returns its URL. The TYRO_API_KEY stays server-side; the patient is
 * sent to the returned hosted URL to save their card. On return we persist the
 * refId (POST /api/patient/card).
 *
 * Scope is derived from the entry token; the patient must belong to the org.
 */
export async function POST(request: NextRequest) {
  const { token, patient_id } = await request.json();

  if (!token || !patient_id) {
    return NextResponse.json({ error: 'token and patient_id are required' }, { status: 400 });
  }

  const scope = await resolveEntryTokenScope(token);
  if (!scope) {
    return NextResponse.json({ error: 'Invalid token' }, { status: 404 });
  }
  if (!(await assertPatientInOrg(patient_id, scope.orgId))) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const [patient] = await db
    .select({
      first_name: patientsT.firstName,
      last_name: patientsT.lastName,
      dob: patientsT.dateOfBirth,
    })
    .from(patientsT)
    .where(eq(patientsT.id, patient_id));

  const [phone] = await db
    .select({ phone_number: patientPhoneNumbers.phoneNumber })
    .from(patientPhoneNumbers)
    .where(eq(patientPhoneNumbers.patientId, patient_id))
    .limit(1);

  const provider = await getTyroProviderForOrg(scope.orgId);
  const refId = await resolvePatientRefId(patient_id);

  try {
    const result = await provider.startCardCapture({
      patientRefId: refId,
      patient: {
        firstName: patient?.first_name ?? '',
        lastName: patient?.last_name ?? '',
        mobile: phone?.phone_number ?? '',
        dob: patient?.dob ?? '',
      },
      // Return the patient to our flow after they save the card.
      redirectUrl: `${getBaseUrl()}/entry/${token}?card_saved=1`,
    });

    if (result.mode !== 'tyro-hosted') {
      return NextResponse.json({ error: 'Tyro not configured' }, { status: 500 });
    }

    return NextResponse.json({
      card_save_url: result.cardSaveUrl,
      patient_ref_id: result.patientRefId,
    });
  } catch (error) {
    console.error('[CARD] Tyro card-save request failed:', error);
    return NextResponse.json({ error: 'Failed to start card capture' }, { status: 500 });
  }
}
