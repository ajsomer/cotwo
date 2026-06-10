// Client-side mirrors of the integration API payloads (no server imports —
// "@/lib/pms/adapter" is types-only, so it's safe in client bundles).

import type { PmsCapabilities } from "@/lib/pms/adapter";

export interface IntegrationStatusDTO {
  hasConnection: boolean;
  syncActive: boolean;
  provider: string | null;
  providerLabel: string | null;
  status: string | null;
  lastSyncedAt: string | null;
  lastSyncError: string | null;
  accountSubdomain: string | null;
  capabilities: PmsCapabilities | null;
  fieldCatalogue: Array<{
    key: string;
    group: string;
    label: string;
    valueType: string;
    enumChoices?: string[];
    writeMode: string;
  }>;
  credentialFields: Array<{
    key: string;
    label: string;
    inputType: "text" | "password";
    placeholder?: string;
    helpText?: string;
  }>;
}

export interface MappingDataDTO {
  connectionId: string;
  // Practitioners (appointment-book columns) → Coviu rooms (§025).
  practitioners: Array<{
    externalId: string;
    displayName: string;
    roomId: string | null;
  }>;
  businesses: Array<{
    externalId: string;
    name: string;
    locationId: string | null;
  }>;
  rooms: Array<{ id: string; name: string }>;
}
