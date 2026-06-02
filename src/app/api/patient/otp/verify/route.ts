import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { phoneVerifications, patientPhoneNumbers, patients } from '@/lib/db/schema';
import { and, eq } from 'drizzle-orm';

/**
 * POST /api/patient/otp/verify
 * Verifies a 6-digit OTP code against phone_verifications.
 * Returns existing patient contacts at the org for identity resolution.
 */
export async function POST(request: NextRequest) {
  const { verification_id, code, org_id } = await request.json();

  if (!verification_id || !code) {
    return NextResponse.json({ error: 'Verification ID and code are required' }, { status: 400 });
  }

  // Look up the verification record
  const [verification] = await db
    .select()
    .from(phoneVerifications)
    .where(eq(phoneVerifications.id, verification_id));

  if (!verification) {
    return NextResponse.json({ error: 'Invalid verification' }, { status: 400 });
  }

  // Check expiry
  if (new Date(verification.expiresAt) < new Date()) {
    return NextResponse.json({ error: 'Code expired. Please request a new one.' }, { status: 410 });
  }

  // Check if already used
  if (verification.verifiedAt) {
    return NextResponse.json({ error: 'Code already used. Please request a new one.' }, { status: 410 });
  }

  // Verify code
  if (verification.code !== code) {
    return NextResponse.json({ error: "That code didn't match. Try again." }, { status: 400 });
  }

  // Mark as verified
  await db
    .update(phoneVerifications)
    .set({ verifiedAt: new Date().toISOString() })
    .where(eq(phoneVerifications.id, verification_id));

  // Update verified_at on matching patient_phone_numbers
  await db
    .update(patientPhoneNumbers)
    .set({ verifiedAt: new Date().toISOString() })
    .where(eq(patientPhoneNumbers.phoneNumber, verification.phoneNumber));

  // Look up existing patient contacts at this org under this phone number
  const contacts = await db
    .select({
      id: patients.id,
      first_name: patients.firstName,
      last_name: patients.lastName,
      date_of_birth: patients.dateOfBirth,
    })
    .from(patientPhoneNumbers)
    .innerJoin(patients, eq(patients.id, patientPhoneNumbers.patientId))
    .where(
      and(
        eq(patientPhoneNumbers.phoneNumber, verification.phoneNumber),
        eq(patients.orgId, org_id)
      )
    );

  const patientList = contacts.map((p) => ({
    id: p.id,
    first_name: p.first_name,
    last_name: p.last_name,
    date_of_birth: p.date_of_birth,
  }));

  return NextResponse.json({
    verified: true,
    phone_number: verification.phoneNumber,
    patients: patientList,
  });
}
