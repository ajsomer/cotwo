import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { getSmsProvider } from '@/lib/sms';

/**
 * POST /api/patient/otp/send
 * Generates a 6-digit OTP, stores it in phone_verifications, and sends via SMS.
 * Rate limited: max 3 sends per phone number per 10-minute window.
 */
export async function POST(request: NextRequest) {
  const { phone_number, session_id } = await request.json();

  if (!phone_number || typeof phone_number !== 'string') {
    return NextResponse.json({ error: 'Phone number is required' }, { status: 400 });
  }

  const supabase = createServiceClient();

  // Rate limit: count recent sends for this phone number (last 10 minutes)
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

  return NextResponse.json({
    verification_id: verification.id,
    expires_at: expiresAt,
    ...(process.env.NODE_ENV === 'development' && { dev_code: code }),
  });
}
