import { db } from '@/lib/db';
import { organisations as organisationsT } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { PaymentProvider, PaymentProviderType } from './provider';
import { ConsolePaymentProvider } from './console';
import { StripePaymentProvider } from './stripe';
import { TyroPaymentProvider, type TyroCredentials } from './tyro';
import { decryptSecret } from './credentials';

/**
 * Returns a payment provider instance.
 *
 * The payment provider is chosen PER ORG (organisations.payment_provider).
 * For Tyro, the org's OWN credentials matter — prefer getTyroProviderForOrg()
 * which loads the connected clinic's API key + business id. This bare factory
 * builds a Tyro provider from env fallback creds (staging/demo).
 *
 * Not cached: Tyro instances are per-org (different creds), so caching by type
 * would leak one org's credentials to another.
 */
export function getPaymentProvider(
  type: PaymentProviderType | null | undefined,
  tyroCreds?: TyroCredentials
): PaymentProvider {
  const resolved: PaymentProviderType = type ?? 'console';
  switch (resolved) {
    case 'tyro':
      return new TyroPaymentProvider(tyroCreds);
    case 'stripe':
      return new StripePaymentProvider();
    case 'console':
    default:
      return new ConsolePaymentProvider();
  }
}

/**
 * Build a TyroPaymentProvider using the ORG's connected credentials (the
 * clinic's own API key + business id from Settings → Payments). Falls back to
 * env creds if the org hasn't connected its own account (prototype/demo).
 */
export async function getTyroProviderForOrg(orgId: string): Promise<TyroPaymentProvider> {
  const [org] = await db
    .select({
      api_key_enc: organisationsT.tyroApiKeyEncrypted,
      business_id: organisationsT.tyroBusinessId,
    })
    .from(organisationsT)
    .where(eq(organisationsT.id, orgId));

  let creds: TyroCredentials | undefined;
  if (org?.api_key_enc && org.business_id) {
    creds = { apiKey: decryptSecret(org.api_key_enc), businessId: org.business_id };
  }
  return new TyroPaymentProvider(creds);
}

export type { PaymentProvider, PaymentProviderType } from './provider';
