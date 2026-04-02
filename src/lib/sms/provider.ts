/**
 * Pluggable SMS provider interface.
 *
 * Two methods:
 * - sendOtp(): Patient phone verification codes
 * - sendNotification(): One-shot run sheet notifications (prep, invite, cancellation)
 *
 * Select implementation via SMS_PROVIDER env var:
 * - "console" (default): Logs to terminal, no SMS sent
 * - "vonage": Calls Vonage SMS API
 */

export interface SmsProvider {
  sendOtp(phoneNumber: string, code: string): Promise<{ success: boolean; error?: string }>;
  sendNotification(phoneNumber: string, message: string): Promise<{ success: boolean; error?: string }>;
}

export type SmsProviderType = 'console' | 'vonage';
