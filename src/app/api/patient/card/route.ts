import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import {
  paymentMethods,
  sessions as sessionsT,
  patients as patientsT,
  organisations as organisationsT,
} from '@/lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { resolveEntryTokenScope } from '@/lib/patient/entry-token';
import { assertPatientInOrg } from '@/lib/auth/staff-access';
import { getTyroProviderForOrg } from '@/lib/payments';

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
    provider = 'stripe',
    stripe_payment_method_id,
    card_last_four,
    card_brand,
    card_expiry,
    // Tyro: the refId the card was saved against, + optional masked card.
    provider_customer_ref,
  } = await request.json();

  const isTyro = provider === 'tyro';

  // Stripe needs a tokenised payment method id; Tyro needs the patient refId.
  if (!token || !patient_id) {
    return NextResponse.json({ error: 'Missing token or patient_id' }, { status: 400 });
  }
  if (isTyro) {
    if (!provider_customer_ref) {
      return NextResponse.json({ error: 'Missing provider_customer_ref' }, { status: 400 });
    }
  } else if (!stripe_payment_method_id || !card_last_four || !card_brand) {
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

  // Insert new payment method. For Tyro the card lives on Tyro's side, so the
  // row is a marker keyed by provider; last-4/brand are stored only if Tyro
  // returned them (often absent), else a neutral placeholder.
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
        provider,
        stripePaymentMethodId: isTyro ? null : stripe_payment_method_id,
        cardLastFour: card_last_four || '••••',
        cardBrand: card_brand || 'Card',
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

  // Tyro: persist the patient's refId so future charges reuse the saved card.
  if (isTyro) {
    await db
      .update(patientsT)
      .set({ providerCustomerRef: provider_customer_ref })
      .where(eq(patientsT.id, patient_id));
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

  // The org's payment provider decides which capture UI the entry flow renders
  // (Stripe inline mock vs Tyro SDK iframe). Derived from the token's org.
  const [org] = await db
    .select({ payment_provider: organisationsT.paymentProvider })
    .from(organisationsT)
    .where(eq(organisationsT.id, scope.orgId));

  const provider = org?.payment_provider ?? 'stripe';

  // For Tyro, the card lives on Tyro's side — recall it by the patient's refId
  // (server-side; keeps the API key off the client) so returning patients see a
  // real "card on file" with last-4. Otherwise read the local Stripe row.
  if (provider === 'tyro') {
    const [patient] = await db
      .select({ ref: patientsT.providerCustomerRef })
      .from(patientsT)
      .where(eq(patientsT.id, patientId));

    let card: { card_last_four: string; card_brand: string; card_expiry: string | null } | null =
      null;
    if (patient?.ref) {
      const tyro = await getTyroProviderForOrg(scope.orgId);
      const saved = await tyro.getSavedCard(patient.ref);
      if (saved) {
        card = {
          card_last_four: saved.cardLastFour,
          card_brand: saved.cardBrand,
          card_expiry: saved.cardExpiry,
        };
      }
    }
    return NextResponse.json({ card, payment_provider: 'tyro' });
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

  return NextResponse.json({
    card: card || null,
    payment_provider: provider,
  });
}
