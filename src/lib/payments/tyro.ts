import type {
  PaymentProvider,
  CapturePatient,
  CreateChargeResult,
  StartCardCaptureResult,
} from './provider';

/**
 * Tyro Health Online (Checkout) payment provider.
 *
 * Verified against staging (see docs/plans/tyro-payments-integration.md §1, §1a):
 * - Base URL https://stg-api-au.medipass.io/v3 (production differs — set TYRO_ENV).
 * - Auth: Bearer TYRO_API_KEY + x-appid (TYRO_APP_ID) + x-appver.
 * - Capture: mint an aud:business-sdk token; the browser SDK runs the popup.
 * - Charge: POST /transactions/invoices with the FLAT request shape (top-level
 *   providerNumber + flat patient object). Returns a hosted paymentRequestUrl.
 *
 * The API key is server-side only and must never reach the client.
 */

import { getBaseUrl } from '@/lib/utils/url';

const TYRO_ENV = (process.env.TYRO_ENV || 'stg') as 'stg' | 'prod';
const BASE_URL =
  TYRO_ENV === 'prod'
    ? 'https://api-au.medipass.io/v3'
    : 'https://stg-api-au.medipass.io/v3';
const APP_VER = process.env.TYRO_APP_VER || 'coviu-proto/0.1';

export interface TyroCredentials {
  apiKey: string;
  businessId: string;
}

export class TyroPaymentProvider implements PaymentProvider {
  private apiKey: string;
  private appId: string;
  private _businessId: string | undefined;

  /**
   * Per-org credentials (the clinic's own Tyro API key + business id) are
   * passed in. Falls back to env vars so the staging/demo business still works
   * for an org that hasn't connected its own account yet. appId is the shared
   * Coviu application id (non-secret), always from env.
   */
  constructor(creds?: TyroCredentials) {
    this.apiKey = creds?.apiKey ?? process.env.TYRO_API_KEY!;
    this._businessId = creds?.businessId ?? process.env.TYRO_BUSINESS_ID;
    // Tolerate the legacy typo'd var name during the prototype.
    this.appId = (process.env.TYRO_APP_ID || process.env.TYPO_APP_ID)!;
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      'x-appid': this.appId,
      'x-appver': APP_VER,
      'Content-Type': 'application/json',
    };
  }

  private businessId(): string | undefined {
    return this._businessId;
  }

  /**
   * Resolve the business id from the API key itself — the key is scoped to one
   * business, so GET /businesses/me returns it. Used at connect time so the
   * clinic only pastes their API key (no manual business id entry).
   */
  async resolveBusinessId(): Promise<string> {
    const res = await fetch(`${BASE_URL}/businesses/me`, { headers: this.headers() });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Tyro business lookup failed (${res.status}): ${body.slice(0, 200)}`);
    }
    const data = (await res.json()) as { items?: Array<{ _id: string }>; _id?: string };
    const id = data.items?.[0]?._id ?? data._id;
    if (!id) throw new Error('Tyro business lookup returned no id');
    return id;
  }

  /**
   * Mint a short-lived SDK token (aud:business-sdk) for the browser SDK.
   * Verified: authenticates as an account-scoped token.
   */
  async mintSdkToken(): Promise<{ token: string; env: 'stg' | 'prod' }> {
    const res = await fetch(`${BASE_URL}/auth/token`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ audience: 'aud:business-sdk', expiresIn: '24h' }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Tyro token mint failed (${res.status}): ${body.slice(0, 300)}`);
    }
    const data = (await res.json()) as { token: string };
    return { token: data.token, env: TYRO_ENV };
  }

  /**
   * Ensure a patient exists on Tyro under our refId and return their Tyro _id.
   * POST /businesses/{businessId}/patients is idempotent on refId (updates the
   * record if the refId already exists).
   */
  private async ensurePatient(
    refId: string,
    patient: CapturePatient
  ): Promise<string> {
    const businessId = this.businessId();
    if (!businessId) throw new Error('TYRO_BUSINESS_ID not configured');

    const res = await fetch(`${BASE_URL}/businesses/${businessId}/patients`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        refId,
        firstName: patient.firstName || 'Patient',
        lastName: patient.lastName || '',
        mobile: patient.mobile || undefined,
        dobString: patient.dob || undefined,
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Tyro create patient failed (${res.status}): ${body.slice(0, 300)}`);
    }
    const data = (await res.json()) as { _id?: string };
    if (!data._id) throw new Error('Tyro create patient returned no _id');
    return data._id;
  }

  /**
   * Start card capture (save card, NO charge) via the REST "request payment
   * details" flow. Ensures the patient exists, then requests a hosted card-save
   * page and returns its URL (paymentMethodUpdateLink). The patient saves their
   * card there; nothing is charged.
   */
  async startCardCapture(input: {
    patientRefId: string;
    patient: CapturePatient;
    redirectUrl?: string;
  }): Promise<StartCardCaptureResult> {
    const businessId = this.businessId();
    if (!businessId) throw new Error('TYRO_BUSINESS_ID not configured');

    const patientId = await this.ensurePatient(input.patientRefId, input.patient);

    const res = await fetch(
      `${BASE_URL}/businesses/${businessId}/patients/${patientId}/paymentmethods/updaterequests`,
      {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify(
          input.redirectUrl ? { redirectUrl: input.redirectUrl } : {}
        ),
      }
    );
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Tyro card-save request failed (${res.status}): ${body.slice(0, 300)}`);
    }
    const data = (await res.json()) as { paymentMethodUpdateLink?: string };
    if (!data.paymentMethodUpdateLink) {
      throw new Error('Tyro returned no paymentMethodUpdateLink');
    }

    return {
      mode: 'tyro-hosted',
      cardSaveUrl: data.paymentMethodUpdateLink,
      patientRefId: input.patientRefId,
    };
  }

  /**
   * Look up a patient's saved cards by refId (server-side; keeps API key off the
   * client). Returns the default/first card's masked details, or null if none.
   * Verified endpoint: GET /businesses/{businessId}/patients/refid/{refId}/paymentmethods
   */
  async getSavedCard(
    refId: string
  ): Promise<{ cardLastFour: string; cardBrand: string; cardExpiry: string | null } | null> {
    const businessId = this.businessId();
    if (!businessId) return null; // Not configured — fall back to no card-on-file.

    const url = `${BASE_URL}/businesses/${businessId}/patients/refid/${encodeURIComponent(
      refId
    )}/paymentmethods`;

    try {
      const res = await fetch(url, { headers: this.headers() });
      if (!res.ok) return null;
      const data = (await res.json()) as {
        items?: Array<{
          lastFour?: string;
          cardType?: string;
          expiryMonth?: string;
          expiryYear?: string;
          isDefault?: boolean;
        }>;
      };
      const items = data.items ?? [];
      if (items.length === 0) return null;
      const card = items.find((i) => i.isDefault) ?? items[0];
      return {
        cardLastFour: card.lastFour ?? '••••',
        cardBrand: card.cardType ?? 'Card',
        cardExpiry:
          card.expiryMonth && card.expiryYear
            ? `${card.expiryMonth}/${card.expiryYear.slice(-2)}`
            : null,
      };
    } catch (error) {
      console.error('[TYRO] getSavedCard failed:', error);
      return null;
    }
  }

  /**
   * Create an invoice (post-consult charge). Returns a hosted paymentRequestUrl —
   * Tyro is patient-present, there is no server-side stored-card charge.
   */
  async createCharge(input: {
    sessionId: string;
    patientRefId: string;
    amountCents: number;
    locationProviderNumber: string;
    patient: CapturePatient;
    description: string;
    sendSms?: boolean;
  }): Promise<CreateChargeResult> {
    const amount = (input.amountCents / 100).toFixed(2);
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

    const body: Record<string, unknown> = {
      // Unique per invoice; ties back to our session for reconciliation.
      invoiceReference: `coviu-${input.sessionId}-${input.amountCents}`,
      // FLAT patient object (NOT patient.identity — that's the PHI claim variant).
      patient: {
        refId: input.patientRefId,
        firstName: input.patient.firstName,
        lastName: input.patient.lastName,
        mobile: input.patient.mobile,
        dobString: input.patient.dob,
      },
      // FLAT top-level providerNumber carries the location/settlement identifier.
      providerNumber: input.locationProviderNumber,
      processingRequest: input.sendSms
        ? { paymentLink: true, sms: { sendToPatientRecordMobile: true } }
        : { paymentLink: true },
      // Register settlement webhooks so api/webhooks/tyro flips payment status.
      webhooks: [
        { method: 'get', url: `${getBaseUrl()}/api/webhooks/tyro`, event: 'invoiceCompleted' },
        { method: 'get', url: `${getBaseUrl()}/api/webhooks/tyro`, event: 'invoiceCancelled' },
      ],
      // Dollar strings, not cents. One non-claimable line (no PHI claiming).
      nonClaimableItems: [
        {
          serviceDateString: today,
          reference: '01',
          displayName: input.description,
          chargeAmount: amount,
          isTaxable: false,
        },
      ],
    };

    const res = await fetch(`${BASE_URL}/transactions/invoices`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(body),
    });

    const text = await res.text();
    if (!res.ok) {
      return { status: 'failed', error: `Tyro charge failed (${res.status}): ${text.slice(0, 300)}` };
    }

    const data = JSON.parse(text) as {
      transactionId?: string;
      paymentRequestUrl?: string;
    };

    if (!data.paymentRequestUrl) {
      return { status: 'failed', error: 'Tyro returned no paymentRequestUrl' };
    }

    return {
      status: 'requires_action',
      providerTxnId: data.transactionId ?? '',
      paymentRequestUrl: data.paymentRequestUrl,
    };
  }
}
