/**
 * Pluggable payment provider interface.
 *
 * Two phases, matching the Coviu workflow:
 * - startCardCapture(): entry-time "save a card" (NO charge). The server returns
 *   whatever the client needs to run the capture UI.
 *     • Tyro   → mints an SDK token (aud:business-sdk); the browser SDK then calls
 *                requestUpdatePaymentDetails({ patientRefId }) in a popup. Card is
 *                vaulted on Tyro's side against our refId. No card data touches us.
 *     • Stripe → a SetupIntent client secret for inline Elements (stub for now).
 * - createCharge(): post-consult charge.
 *     • Tyro   → creates an invoice; returns a hosted paymentRequestUrl the patient
 *                completes (patient-present — Tyro has no server-side token charge).
 *     • Stripe → immediate capture (stub returns 'completed').
 *
 * Select implementation per ORGANISATION (organisations.payment_provider), not a
 * global env var — resolved by getPaymentProvider(type). 'console' is the no-op
 * default for local/dev, mirroring src/lib/sms.
 */

export type PaymentProviderType = 'stripe' | 'tyro' | 'console';

export interface CapturePatient {
  firstName: string;
  lastName: string;
  mobile: string;
  /** ISO date, YYYY-MM-DD. */
  dob: string;
}

export type StartCardCaptureResult =
  // Tyro: a hosted "save card" page URL (no charge). Patient saves their card
  // there; we persist the refId on return.
  | { mode: 'tyro-hosted'; cardSaveUrl: string; patientRefId: string }
  | { mode: 'stripe-elements'; clientSecret: string }
  | { mode: 'noop' };

export type CreateChargeResult =
  | { status: 'completed'; providerTxnId: string }
  | { status: 'requires_action'; providerTxnId: string; paymentRequestUrl: string }
  | { status: 'failed'; error: string };

export interface PaymentProvider {
  /**
   * Begin entry-time card capture (save card, no charge). Returns the client-side
   * handle the entry flow needs to launch the provider's capture UI.
   */
  startCardCapture(input: {
    patientRefId: string;
    patient: CapturePatient;
  }): Promise<StartCardCaptureResult>;

  /**
   * Charge a patient post-consult. Discriminated result is the honest contract:
   * Tyro returns 'requires_action' + a hosted paymentRequestUrl (patient/staff
   * completes); Stripe (stub) returns 'completed'.
   */
  createCharge(input: {
    sessionId: string;
    patientRefId: string;
    amountCents: number;
    /** Tyro location/settlement identifier (e.g. T01LHM0B). */
    locationProviderNumber: string;
    patient: CapturePatient;
    description: string;
    /** Tyro: also send the payment request to the patient by SMS. */
    sendSms?: boolean;
  }): Promise<CreateChargeResult>;
}
