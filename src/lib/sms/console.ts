import { SmsProvider } from './provider';

/**
 * Console SMS provider — logs OTP codes and notifications to the terminal.
 * Used for development and demos. No actual SMS is sent.
 */
export class ConsoleSmsProvider implements SmsProvider {
  async sendOtp(phoneNumber: string, code: string) {
    console.log(`\n📱 [SMS OTP] To: ${phoneNumber}`);
    console.log(`   Code: ${code}`);
    console.log(`   (Development mode — no SMS sent)\n`);
    return { success: true };
  }

  async sendNotification(phoneNumber: string, message: string) {
    console.log(`\n📨 [SMS Notification] To: ${phoneNumber}`);
    console.log(`   Message: ${message}`);
    console.log(`   (Development mode — no SMS sent)\n`);
    return { success: true };
  }
}
