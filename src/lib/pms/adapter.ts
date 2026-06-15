/**
 * The vendor-agnostic PMS contract.
 *
 * Every UI surface and the sync engine are written against `PmsAdapter` — no
 * code outside `src/lib/pms/<provider>/` ever references a concrete provider.
 * Adding a PMS is: implement this interface in a new folder and register it.
 *
 * See docs/plans/cliniko-integration.md §4, §6.
 */
import type {
  PmsAppointment,
  PmsAppointmentType,
  PmsBusiness,
  PmsFailureKind,
  PmsFormSubmissionInput,
  PmsPatient,
  PmsPractitioner,
  PmsPushResult,
} from "./types";

/** What surfaces a provider supports — drives capability-gated UI (§7b). */
export interface PmsCapabilities {
  /** Provider supports push webhooks (none do today → polling). */
  webhooks: boolean;
  /** Can post self-contained form answers back. */
  writeForms: boolean;
  /** Can PATCH native patient fields. */
  writePatientFields: boolean;
  /** Can write clinical notes (held in reserve, not used in v1). */
  writeNotes: boolean;
  /** Can attach files (e.g. the intake PDF) to a patient record. */
  writeAttachments: boolean;
  /** Exposes human-facing web-app deep links for entities. */
  webLinks: boolean;
}

/** How the adapter will write a catalogue target. */
export type PmsWriteMode = "patient_field" | "form_answer";

/** Value shape of a catalogue target (drives validation + builder hints). */
export type PmsFieldValueType =
  | "text"
  | "longtext"
  | "date"
  | "phone"
  | "enum";

/**
 * One write target the provider exposes. Emitted as plain data so every generic
 * surface (builder dropdown, seeded form, push) consumes it without branching
 * on the provider. Keys are PROVIDER-NAMESPACED, e.g. 'cliniko:patient.dob'.
 */
export interface PmsFieldCatalogueEntry {
  key: string;
  /** Groups the builder dropdown, e.g. 'Patient' | 'Form answer'. */
  group: string;
  /** What the practice manager sees in the builder. */
  label: string;
  valueType: PmsFieldValueType;
  /** Accepted values for enum targets (e.g. Cliniko's `sex` values). */
  enumChoices?: string[];
  writeMode: PmsWriteMode;
}

/** Result of per-target validation (powers actionable failure messages). */
export type PmsFieldValidation =
  | { ok: true }
  | { ok: false; failureKind: PmsFailureKind; detail: string };

/** A single credential field the connect form should collect. */
export interface PmsCredentialField {
  key: string;
  label: string;
  /** Render hint for the connect form. */
  inputType: "text" | "password";
  placeholder?: string;
  helpText?: string;
}

export interface PmsAdapter {
  /** Stable provider id matching the `pms_provider` enum. */
  readonly provider: string;
  /** Human label, e.g. "Cliniko". */
  readonly displayName: string;

  // ── CONNECTION ──
  /** Cheap authenticated check. */
  verify(): Promise<{ ok: boolean; detail?: string }>;

  // ── READ ──
  listAppointments(opts: {
    since?: Date;
    businessId?: string;
  }): AsyncIterable<PmsAppointment>;
  listPatients(opts: { since?: Date }): AsyncIterable<PmsPatient>;
  /** Fetch a single patient by external id (lazy link during appt sync). */
  getPatient(externalId: string): Promise<PmsPatient | null>;
  /** Fetch a single appointment by external id (reconciliation re-pull). */
  getAppointment(externalId: string): Promise<PmsAppointment | null>;
  listPractitioners(): Promise<PmsPractitioner[]>;
  listAppointmentTypes(): Promise<PmsAppointmentType[]>;
  listBusinesses(): Promise<PmsBusiness[]>;

  // ── WRITE ──
  /** Push a completed form; returns a per-field result for the UI (§6.1). */
  pushFormSubmission(input: PmsFormSubmissionInput): Promise<PmsPushResult>;
  /**
   * Attach a file (e.g. the intake PDF) to a patient's record, if supported.
   * `externalId` is the PMS patient id. Returns the created attachment id.
   */
  uploadPatientAttachment?(input: {
    externalId: string;
    fileName: string;
    contentType: string;
    /** Base64-encoded file content. */
    contentBase64: string;
    description?: string;
    /**
     * PMS practitioner external id to file the attachment against, resolved
     * from the appointment's practitioner. Required by some providers (Gentu's
     * `PUT .../attachments` takes a mandatory `practitionerId`); ignored by
     * those whose attachment flow is patient-scoped (Cliniko, Nookal).
     */
    practitionerExternalId?: string;
  }): Promise<{ ok: boolean; attachmentId?: string; detail?: string }>;

  // ── METADATA for the UI ──
  capabilities(): PmsCapabilities;
  /** Static, provider-namespaced write targets (§6). */
  fieldCatalogue(): PmsFieldCatalogueEntry[];
  /** Per-target validation/coercion. */
  validateField(key: string, value: string): PmsFieldValidation;
  /** Human-facing web-app URL for a patient, or null if unsupported (§6.2). */
  webLinkForPatient(externalId: string): string | null;
  /**
   * Fetch a provider-opaque web-link hint (e.g. Cliniko account subdomain),
   * fetched once at connect and stored for webLinkForPatient. Null if N/A.
   */
  getWebHint?(): Promise<string | null>;
  /** Credential fields the connect form should collect. */
  credentialFields(): PmsCredentialField[];
}

/**
 * The opaque credentials blob the generic layer stores/encrypts and hands back.
 * The generic layer never inspects it; only the adapter does.
 */
export type PmsCredentials = Record<string, string>;

/** A factory turns a stored credentials blob + connection into a live adapter. */
export interface PmsAdapterFactory {
  readonly provider: string;
  readonly displayName: string;
  /** Build a live adapter for a connection's credentials. */
  create(args: {
    connectionId: string;
    credentials: PmsCredentials;
    /** Provider-opaque hint for web deep links (e.g. Cliniko account subdomain). */
    webHint?: string | null;
  }): PmsAdapter;
  /**
   * Exchange the connect-form input for the credentials blob that gets STORED,
   * if they differ. Cliniko/Nookal store the API key as-is and omit this. Gentu
   * collects a one-time `pairing_code` and exchanges it for a durable
   * `tenant_id` (the pairing code is single-use). Called by `connectPms` before
   * verify/encrypt. Return `{ ok: false, detail }` to abort the connect with an
   * actionable message. When omitted, the form input is stored verbatim.
   */
  exchangeCredentials?(
    input: PmsCredentials
  ): Promise<
    { ok: true; credentials: PmsCredentials } | { ok: false; detail: string }
  >;
  /** Metadata available WITHOUT credentials (capabilities, catalogue, fields). */
  staticMetadata(): {
    capabilities: PmsCapabilities;
    fieldCatalogue: PmsFieldCatalogueEntry[];
    credentialFields: PmsCredentialField[];
  };
}
