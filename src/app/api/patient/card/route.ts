import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { paymentMethods, sessions as sessionsT } from '@/lib/db/schema';
import { and, eq } from 'drizzle-orm';
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

  const scope = await resolveEntryTokenScope(token);
  if (!scope) {
    return NextResponse.json({ error: 'Invalid token' }, { status: 404 });
  }
  if (!(await assertPatientInOrg(patient_id, scope.orgId))) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  // Mark any existing default cards as non-default
  await db
    .update(paymentMethods)
    .set({ isDefault: false })
    .where(
      and(
        eq(paymentMethods.patientId, patient_id),
        eq(paymentMethods.isDefault, true)
      )
    );

  // Insert new payment method
  let paymentMethod: {
    id: string;
    card_last_four: string;
    card_brand: string;
    card_expiry: string | null;
  };
  try {
    [paymentMethod] = await db
      .insert(paymentMethods)
      .values({
        patientId: patient_id,
        stripePaymentMethodId: stripe_payment_method_id,
        cardLastFour: card_last_four,
        cardBrand: card_brand,
        cardExpiry: card_expiry || null,
        isDefault: true,
      })
      .returning({
        id: paymentMethods.id,
        card_last_four: paymentMethods.cardLastFour,
        card_brand: paymentMethods.cardBrand,
        card_expiry: paymentMethods.cardExpiry,
      });
  } catch (error) {
    console.error('[CARD] Failed to store payment method:', error);
    return NextResponse.json({ error: 'Failed to store card' }, { status: 500 });
  }

  // Update session tracking — use the token's session, never a caller value.
  if (scope.sessionId) {
    await db
      .update(sessionsT)
      .set({ cardCaptured: true })
      .where(eq(sessionsT.id, scope.sessionId));
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

  const scope = await resolveEntryTokenScope(token);
  if (!scope) {
    return NextResponse.json({ error: 'Invalid token' }, { status: 404 });
  }
  if (!(await assertPatientInOrg(patientId, scope.orgId))) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const [card] = await db
    .select({
      id: paymentMethods.id,
      card_last_four: paymentMethods.cardLastFour,
      card_brand: paymentMethods.cardBrand,
      card_expiry: paymentMethods.cardExpiry,
      is_default: paymentMethods.isDefault,
    })
    .from(paymentMethods)
    .where(
      and(
        eq(paymentMethods.patientId, patientId),
        eq(paymentMethods.isDefault, true)
      )
    );

  return NextResponse.json({ card: card || null });
}
