import "server-only";
import type { PmsAdapter, PmsAdapterFactory } from "./adapter";
import { decryptCredentials } from "./credentials";
import { clinikoFactory } from "./cliniko/adapter";
import { nookalFactory } from "./nookal/adapter";

/**
 * Provider registry. The single place that knows which concrete adapters exist.
 * Everything else resolves a provider by its `pms_provider` enum value and then
 * talks only to the `PmsAdapter` / `PmsAdapterFactory` interfaces.
 *
 * Adding a PMS = ship an adapter folder and add one line here.
 */
const FACTORIES: Record<string, PmsAdapterFactory> = {
  [clinikoFactory.provider]: clinikoFactory,
  [nookalFactory.provider]: nookalFactory,
};

/** Provider enum values that have a real adapter wired up. */
export function supportedProviders(): string[] {
  return Object.keys(FACTORIES);
}

export function getFactory(provider: string): PmsAdapterFactory | null {
  return FACTORIES[provider] ?? null;
}

/** Static metadata for a provider WITHOUT credentials (capability-gated UI). */
export function getStaticMetadata(provider: string) {
  const f = getFactory(provider);
  return f ? f.staticMetadata() : null;
}

/**
 * Build a live, authenticated adapter from a stored connection row.
 * Returns null when the connection has no credentials (not sync-active) or the
 * provider has no registered adapter.
 */
export function buildAdapter(connection: {
  id: string;
  provider: string;
  credentials_encrypted: string | null;
  account_subdomain?: string | null;
}): PmsAdapter | null {
  if (!connection.credentials_encrypted) return null;
  const factory = getFactory(connection.provider);
  if (!factory) return null;
  let credentials;
  try {
    credentials = decryptCredentials(connection.credentials_encrypted);
  } catch {
    return null;
  }
  return factory.create({
    connectionId: connection.id,
    credentials,
    webHint: connection.account_subdomain ?? null,
  });
}
