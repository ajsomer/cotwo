import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { resolveEntryTokenScope } from '@/lib/patient/entry-token';
import { assertPatientInOrg } from '@/lib/auth/staff-access';

/**
 * POST /api/patient/card
 * Stores a payment method reference after Stripe tokenisation.
 * Called after the client-side Stripe Elements card capture.
 *
 * Also: GET to check if patient has a card on file.
 *
 * Scope is derived from the entry token: the patient must belong to the
 * token's org, and the session updated is the token's session — not a
 * caller-supplied id — so a card can't be attached to another patient or
 * another patient's session.
 */
export async function POST(request: NextRequest) {
  const {
    token,
    patient_id,
    stripe_payment_method_id,
    card_last_four,
    card_brand,
    card_expiry,
  } = await request.json();

  if (!token || !patient_id || !stripe_payment_method_id || !card_last_four || !card_brand) {
    return NextResponse.json({ error: 'Missing required card fields' }, { status: 400 });
  }

  const supabase = createServiceClient();

  const scope = await resolveEntryTokenScope(supabase, token);
  if (!scope) {
    return NextResponse.json({ error: 'Invalid token' }, { status: 404 });
  }
  if (!(await assertPatientInOrg(supabase, patient_id, scope.orgId))) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

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

  // Update session tracking — use the token's session, never a caller value.
  if (scope.sessionId) {
    await supabase
      .from('sessions')
      .update({ card_captured: true })
      .eq('id', scope.sessionId);
  }

  return NextResponse.json({ payment_method: paymentMethod });
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const token = searchParams.get('token');
  const patientId = searchParams.get('patient_id');

  if (!token || !patientId) {
    return NextResponse.json({ error: 'token and patient_id are required' }, { status: 400 });
  }

  const supabase = createServiceClient();

  const scope = await resolveEntryTokenScope(supabase, token);
  if (!scope) {
    return NextResponse.json({ error: 'Invalid token' }, { status: 404 });
  }
  if (!(await assertPatientInOrg(supabase, patientId, scope.orgId))) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const { data: card } = await supabase
    .from('payment_methods')
    .select('id, card_last_four, card_brand, card_expiry, is_default')
    .eq('patient_id', patientId)
    .eq('is_default', true)
    .single();

  return NextResponse.json({ card: card || null });
}
