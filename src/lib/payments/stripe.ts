import type {
  PaymentProvider,
  CreateChargeResult,
  StartCardCaptureResult,
} from './provider';

/**
 * Stripe payment provider — STUBBED.
 *
 * Stripe is not implemented in this prototype (see src/lib/stripe/*). This wraps
 * the existing stub behaviour behind the provider interface so the default org
 * path is unchanged: capture pretends to issue a SetupIntent, charge reports
 * 'completed' immediately. Replace the bodies with real Stripe calls when Stripe
 * is implemented for real.
 */
export class StripePaymentProvider implements PaymentProvider {
  async startCardCapture(): Promise<StartCardCaptureResult> {
    // TODO(stripe): create a real SetupIntent and return its client_secret.
    return { mode: 'stripe-elements', clientSecret: 'seti_test_stub' };
  }

  async createCharge(input: {
    sessionId: string;
  }): Promise<CreateChargeResult> {
    // TODO(stripe): create + confirm a PaymentIntent off the saved payment method.
    return { status: 'completed', providerTxnId: `pi_test_${input.sessionId}` };
  }
}
