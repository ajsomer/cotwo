import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import {
  sessions as sessionsT,
  locations as locationsT,
  organisations as organisationsT,
  sessionParticipants,
  patients as patientsT,
  patientPhoneNumbers,
} from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { requireStaffLocationAccess } from '@/lib/auth/staff-access';
import { denyResponse } from '@/lib/api/route-helpers';
import { getTyroProviderForOrg } from '@/lib/payments';
import { resolvePatientRefId } from '@/lib/payments/ref-id';

/**
 * POST /api/clinic/tyro-charge-config  { session_id }
 *
 * Clinic-side: returns everything the browser needs to open Tyro's SDK charge
 * window (renderCreateTransaction) for a session — a short-lived SDK token, the
 * appId, env, the org's Tyro provider/location number, and the patient details
 * (incl. refId) to pre-populate. Staff-auth gated by the session's location.
 */
export async function POST(request: NextRequest) {
  const { session_id } = await request.json();
  if (!session_id) {
    return NextResponse.json({ error: 'session_id required' }, { status: 400 });
  }

  const [session] = await db
    .select({
      location_id: sessionsT.locationId,
      org_id: organisationsT.id,
      provider: organisationsT.paymentProvider,
      provider_number: organisationsT.tyroProviderNumber,
    })
    .from(sessionsT)
    .innerJoin(locationsT, eq(locationsT.id, sessionsT.locationId))
    .innerJoin(organisationsT, eq(organisationsT.id, locationsT.orgId))
    .where(eq(sessionsT.id, session_id));

  if (!session) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }

  const access = await requireStaffLocationAccess(session.location_id);
  if (!access.ok) return denyResponse(access);

  if (session.provider !== 'tyro') {
    return NextResponse.json({ error: 'Org is not on Tyro' }, { status: 400 });
  }

  // Resolve the session's patient + refId for pre-population.
  const [participant] = await db
    .select({ patient_id: sessionParticipants.patientId })
    .from(sessionParticipants)
    .where(eq(sessionParticipants.sessionId, session_id))
    .limit(1);

  let patient = { first_name: '', last_name: '', mobile: '', dob: '', ref_id: '' };
  if (participant?.patient_id) {
    const [p] = await db
      .select({
        first_name: patientsT.firstName,
        last_name: patientsT.lastName,
        dob: patientsT.dateOfBirth,
      })
      .from(patientsT)
      .where(eq(patientsT.id, participant.patient_id));
    const [phone] = await db
      .select({ phone_number: patientPhoneNumbers.phoneNumber })
      .from(patientPhoneNumbers)
      .where(eq(patientPhoneNumbers.patientId, participant.patient_id))
      .limit(1);
    const refId = await resolvePatientRefId(participant.patient_id);
    patient = {
      first_name: p?.first_name ?? '',
      last_name: p?.last_name ?? '',
      mobile: phone?.phone_number ?? '',
      dob: p?.dob ?? '',
      ref_id: refId,
    };
  }

  try {
    const provider = await getTyroProviderForOrg(session.org_id);
    const sdk = await provider.mintSdkToken();
    return NextResponse.json({
      sdk_token: sdk.token,
      env: sdk.env,
      app_id: process.env.TYRO_APP_ID || process.env.TYPO_APP_ID || '',
      provider_number: session.provider_number ?? '',
      patient,
    });
  } catch (error) {
    console.error('[CLINIC] Tyro charge config failed:', error);
    return NextResponse.json({ error: 'Failed to prepare charge' }, { status: 500 });
  }
}
