// Client-side mirrors of the integration API payloads (no server imports).

export interface IntegrationStatusDTO {
  hasConnection: boolean;
  syncActive: boolean;
  provider: string | null;
  providerLabel: string | null;
  status: string | null;
  lastSyncedAt: string | null;
  lastSyncError: string | null;
  capabilities: {
    webhooks: boolean;
    writeForms: boolean;
    writePatientFields: boolean;
    writeNotes: boolean;
    webLinks: boolean;
  } | null;
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
  appointmentTypes: Array<{
    externalId: string;
    name: string;
    durationMinutes: number | null;
    appointmentTypeId: string | null;
    confirmedModality: "telehealth" | "in_person" | null;
    roomId: string | null;
    syncEnabled: boolean;
    hasWorkflowLink: boolean;
  }>;
  practitioners: Array<{
    externalId: string;
    displayName: string;
    staffAssignmentId: string | null;
  }>;
  businesses: Array<{
    externalId: string;
    name: string;
    locationId: string | null;
  }>;
  rooms: Array<{ id: string; name: string }>;
  clinicians: Array<{ staffAssignmentId: string; name: string }>;
}
