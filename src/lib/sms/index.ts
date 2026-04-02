import { SmsProvider, SmsProviderType } from './provider';
import { ConsoleSmsProvider } from './console';
import { VonageSmsProvider } from './vonage';

let _provider: SmsProvider | null = null;

/**
 * Returns the configured SMS provider singleton.
 * Reads SMS_PROVIDER from env: "console" (default) or "vonage".
 */
export function getSmsProvider(): SmsProvider {
  if (!_provider) {
    const type = (process.env.SMS_PROVIDER || 'console') as SmsProviderType;

    switch (type) {
      case 'vonage':
        _provider = new VonageSmsProvider();
        break;
      case 'console':
      default:
        _provider = new ConsoleSmsProvider();
        break;
    }
  }

  return _provider;
}

export type { SmsProvider } from './provider';
