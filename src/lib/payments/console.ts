import type {
  PaymentProvider,
  CreateChargeResult,
  StartCardCaptureResult,
} from './provider';

/**
 * Console payment provider — logs to the terminal, charges nothing.
 * Default for local dev / demos and for orgs with no provider configured.
 */
export class ConsolePaymentProvider implements PaymentProvider {
  async startCardCapture(input: {
    patientRefId: string;
  }): Promise<StartCardCaptureResult> {
    console.warn(`💳 [PAYMENT capture] refId: ${input.patientRefId} (console mode — no card captured)`);
    return { mode: 'noop' };
  }

  async createCharge(input: {
    sessionId: string;
    amountCents: number;
  }): Promise<CreateChargeResult> {
    console.warn(
      `💳 [PAYMENT charge] session: ${input.sessionId} amount: $${(input.amountCents / 100).toFixed(2)} (console mode — no charge made)`
    );
    return { status: 'completed', providerTxnId: `console_${input.sessionId}` };
  }
}
