import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';

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

  const supabase = createServiceClient();

  // Look up the verification record
  const { data: verification } = await supabase
    .from('phone_verifications')
    .select('*')
    .eq('id', verification_id)
    .single();

  if (!verification) {
    return NextResponse.json({ error: 'Invalid verification' }, { status: 400 });
  }

  // Check expiry
  if (new Date(verification.expires_at) < new Date()) {
    return NextResponse.json({ error: 'Code expired. Please request a new one.' }, { status: 410 });
  }

  // Check if already used
  if (verification.verified_at) {
    return NextResponse.json({ error: 'Code already used. Please request a new one.' }, { status: 410 });
  }

  // Verify code
  if (verification.code !== code) {
    return NextResponse.json({ error: "That code didn't match. Try again." }, { status: 400 });
  }

  // Mark as verified
  await supabase
    .from('phone_verifications')
    .update({ verified_at: new Date().toISOString() })
    .eq('id', verification_id);

  // Update verified_at on matching patient_phone_numbers
  await supabase
    .from('patient_phone_numbers')
    .update({ verified_at: new Date().toISOString() })
    .eq('phone_number', verification.phone_number);

  // Look up existing patient contacts at this org under this phone number
  const { data: contacts } = await supabase
    .from('patient_phone_numbers')
    .select('patient_id, patients!inner (id, first_name, last_name, date_of_birth)')
    .eq('phone_number', verification.phone_number)
    .eq('patients.org_id', org_id);

  const patients = (contacts || []).map((c: any) => ({
    id: c.patients.id,
    first_name: c.patients.first_name,
    last_name: c.patients.last_name,
    date_of_birth: c.patients.date_of_birth,
  }));

  return NextResponse.json({
    verified: true,
    phone_number: verification.phone_number,
    patients,
  });
}
