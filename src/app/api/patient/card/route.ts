import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';

/**
 * POST /api/patient/card
 * Stores a payment method reference after Stripe tokenisation.
 * Called after the client-side Stripe Elements card capture.
 *
 * Also: GET to check if patient has a card on file.
 */
export async function POST(request: NextRequest) {
  const {
    patient_id,
    stripe_payment_method_id,
    card_last_four,
    card_brand,
    card_expiry,
    session_id,
  } = await request.json();

  if (!patient_id || !stripe_payment_method_id || !card_last_four || !card_brand) {
    return NextResponse.json({ error: 'Missing required card fields' }, { status: 400 });
  }

  const supabase = createServiceClient();

  // Mark any existing default cards as non-default
  await supabase
    .from('payment_methods')
    .update({ is_default: false })
    .eq('patient_id', patient_id)
    .eq('is_default', true);

  // Insert new payment method
  const { data: paymentMethod, error } = await supabase
    .from('payment_methods')
    .insert({
      patient_id,
      stripe_payment_method_id,
      card_last_four,
      card_brand,
      card_expiry: card_expiry || null,
      is_default: true,
    })
    .select('id, card_last_four, card_brand, card_expiry')
    .single();

  if (error) {
    console.error('[CARD] Failed to store payment method:', error);
    return NextResponse.json({ error: 'Failed to store card' }, { status: 500 });
  }

  // Update session tracking
  if (session_id) {
    await supabase
      .from('sessions')
      .update({ card_captured: true })
      .eq('id', session_id);
  }

  return NextResponse.json({ payment_method: paymentMethod });
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const patientId = searchParams.get('patient_id');

  if (!patientId) {
    return NextResponse.json({ error: 'patient_id is required' }, { status: 400 });
  }

  const supabase = createServiceClient();

  const { data: card } = await supabase
    .from('payment_methods')
    .select('id, card_last_four, card_brand, card_expiry, is_default')
    .eq('patient_id', patientId)
    .eq('is_default', true)
    .single();

  return NextResponse.json({ card: card || null });
}
