import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { getSmsProvider } from '@/lib/sms';
import { normalisePhone } from '@/lib/phone/normalise';

/**
 * POST /api/patient/otp/send
 * Generates a 6-digit OTP, stores it in phone_verifications, and sends via SMS.
 * Rate limited: max 3 sends per phone number per 10-minute window.
 */
export async function POST(request: NextRequest) {
  const { phone_number: rawPhone, session_id } = await request.json();

  if (!rawPhone || typeof rawPhone !== 'string') {
    return NextResponse.json({ error: 'Phone number is required' }, { status: 400 });
  }

  // Normalise to E.164 up front so the verification record — and every later
  // match against patient_phone_numbers — uses the canonical form.
  const phone_number = normalisePhone(rawPhone);
  if (!phone_number) {
    return NextResponse.json({ error: 'Invalid phone number' }, { status: 400 });
  }

  const supabase = createServiceClient();

  // Rate limit: count recent sends for this phone number (last 10 minutes)
  // Onboarding demo number is exempt — the test session creates a new patient
  // contact every time, so the same number gets exercised repeatedly during demos.
  const ONBOARDING_DEMO_NUMBER = '+61400000000';
  if (phone_number !== ONBOARDING_DEMO_NUMBER) {
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const { count } = await supabase
      .from('phone_verifications')
      .select('*', { count: 'exact', head: true })
      .eq('phone_number', phone_number)
      .gte('created_at', tenMinutesAgo);

    if ((count || 0) >= 3) {
      return NextResponse.json(
        { error: 'Too many verification attempts. Please wait a few minutes.' },
        { status: 429 }
      );
    }
  }

  // Generate 6-digit code
  const code = Math.floor(100000 + Math.random() * 900000).toString();
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();

  // Store verification record
  const { data: verification, error } = await supabase
    .from('phone_verifications')
    .insert({
      phone_number,
      code,
      expires_at: expiresAt,
      session_id: session_id || null,
    })
    .select('id')
    .single();

  if (error) {
    console.error('[OTP] Failed to store verification:', error);
    return NextResponse.json({ error: 'Failed to send code' }, { status: 500 });
  }

  // Send OTP via SMS provider
  const sms = getSmsProvider();
  const result = await sms.sendOtp(phone_number, code);

  if (!result.success) {
    console.error('[OTP] SMS send failed:', result.error);
    return NextResponse.json({ error: 'Failed to send code' }, { status: 500 });
  }

  // PROTOTYPE: always return the OTP so the patient entry flow can auto-fill it.
  // This is a demo build shown to customers, not a production app — there is no
  // real SMS delivery to rely on. REMOVE this (gate behind NODE_ENV/PROTOTYPE_MODE)
  // before any production deployment so the code is never exposed to the client.
  return NextResponse.json({
    verification_id: verification.id,
    expires_at: expiresAt,
    dev_code: code,
  });
}
