import { SmsProvider } from './provider';

/**
 * Vonage SMS provider — sends real SMS via the Vonage API.
 * Requires VONAGE_API_KEY and VONAGE_API_SECRET env vars.
 */
export class VonageSmsProvider implements SmsProvider {
  private apiKey: string;
  private apiSecret: string;
  private fromNumber: string;

  constructor() {
    this.apiKey = process.env.VONAGE_API_KEY!;
    this.apiSecret = process.env.VONAGE_API_SECRET!;
    this.fromNumber = process.env.VONAGE_FROM_NUMBER || 'Coviu';
  }

  async sendOtp(phoneNumber: string, code: string) {
    return this.send(
      phoneNumber,
      `Your verification code is ${code}. It expires in 5 minutes.`
    );
  }

  async sendNotification(phoneNumber: string, message: string) {
    return this.send(phoneNumber, message);
  }

  private async send(to: string, text: string): Promise<{ success: boolean; error?: string }> {
    try {
      const response = await fetch('https://rest.nexmo.com/sms/json', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_key: this.apiKey,
          api_secret: this.apiSecret,
          from: this.fromNumber,
          to: to.replace(/\+/g, ''),
          text,
        }),
      });

      const data = await response.json();
      const msg = data.messages?.[0];

      if (msg?.status === '0') {
        return { success: true };
      }

      return { success: false, error: msg?.['error-text'] || 'Unknown Vonage error' };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'SMS send failed' };
    }
  }
}
