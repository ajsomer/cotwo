/**
 * Canonical PMS domain types (vendor-agnostic).
 *
 * The Coviu sync engine only ever speaks these shapes. A concrete adapter
 * (Cliniko, Halaxy, …) translates its own payloads into / out of these. Nothing
 * here knows about any specific provider.
 *
 * See docs/plans/cliniko-integration.md §4.
 */

/** A patient as the PMS knows it. */
export interface PmsPatient {
  /** Provider-native id (account-scoped string). */
  externalId: string;
  firstName: string;
  lastName: string;
  /** ISO date (YYYY-MM-DD) or null if the PMS has none. */
  dateOfBirth: string | null;
  /** E.164 where we can derive it; raw otherwise. May be empty. */
  phoneNumbers: string[];
  email: string | null;
  /** Set when the PMS marks the patient archived/inactive. */
  archived: boolean;
}

/** A practitioner / provider as the PMS knows it. */
export interface PmsPractitioner {
  externalId: string;
  firstName: string;
  lastName: string;
  /** Convenience display name the adapter assembles. */
  displayName: string;
  email: string | null;
  active: boolean;
}

/** A bookable appointment type as the PMS knows it. */
export interface PmsAppointmentType {
  externalId: string;
  name: string;
  /** Minutes; null if the PMS doesn't expose a duration. */
  durationMinutes: number | null;
  archived: boolean;
}

/** A "business" / clinic location as the PMS knows it. */
export interface PmsBusiness {
  externalId: string;
  name: string;
  /** IANA tz if the PMS exposes one. */
  timeZone: string | null;
  archived: boolean;
}

/** An appointment as the PMS knows it (the read-sync payload). */
export interface PmsAppointment {
  externalId: string;
  /** FK strings into the other PMS resources. */
  patientExternalId: string | null;
  practitionerExternalId: string | null;
  appointmentTypeExternalId: string | null;
  businessExternalId: string | null;
  /** ISO 8601 UTC. */
  startsAt: string | null;
  endsAt: string | null;
  /** Canonical lifecycle the adapter derives from the PMS's flags. */
  cancelled: boolean;
  didNotArrive: boolean;
  archived: boolean;
  /** Max(updated_at) hint for cursor advancement. ISO 8601. */
  updatedAt: string | null;
}

// ───────────────────────── Write (outbound) ─────────────────────────

/**
 * What push.ts hands the adapter: a provider-agnostic bundle of
 * { catalogue key, value } pairs resolved from a completed Coviu form.
 *
 * The adapter resolves the PMS patient id itself (from the connection's link
 * table) — push.ts only supplies the Coviu patient id and the field bundle.
 */
export interface PmsFormSubmissionInput {
  /** Coviu patient uuid; the adapter maps it to its external id. */
  patientId: string;
  /** Connection this push runs under (selects creds + link rows). */
  connectionId: string;
  /** Human label for the posted form (e.g. the Coviu form name). */
  formName: string;
  /** Existing patient_form id to PATCH (idempotent re-send), if known. §8.G */
  existingFormExternalId?: string;
  fields: PmsFormFieldInput[];
}

export interface PmsFormFieldInput {
  /** SurveyJS question `name` — echoed back in the result for the UI. */
  questionName: string;
  /** Provider-namespaced catalogue key, e.g. 'cliniko:patient.date_of_birth'. */
  targetKey: string;
  /** Human label for the field (for the result row). */
  label: string;
  /** The value the patient submitted, stringified. */
  value: string;
}

/** Result of a single field write — drives the §6.1 per-field feedback UI. */
export interface PmsFieldResult {
  /** SurveyJS question name. */
  coviuQuestionName: string;
  /** Catalogue key, e.g. 'cliniko:patient.date_of_birth'. */
  target: string;
  /** Human label for the field. */
  label: string;
  /** Value we tried to write (pre-fills the inline edit box on a failure). */
  attemptedValue: string;
  status: PmsFieldWriteStatus;
  /** Why it failed (only on status === 'failed'). */
  failureKind?: PmsFailureKind;
  /** Specific, actionable detail message. */
  detail?: string;
}

export type PmsFieldWriteStatus =
  | "written"
  | "skipped_existing"
  | "unmapped"
  | "failed";

export type PmsFailureKind = "validation" | "transport" | "auth" | "mapping";

/** Aggregate result the adapter returns from pushFormSubmission. */
export interface PmsPushResult {
  /** Created/updated patient_form id, if any (idempotency key). */
  externalId?: string;
  fields: PmsFieldResult[];
}

/** Outcome of a per-field retry / inline-edit re-send. */
export interface PmsFieldRetryInput {
  connectionId: string;
  patientId: string;
  questionName: string;
  targetKey: string;
  label: string;
  value: string;
  /** Existing patient_form id to PATCH rather than re-POST, if known. */
  existingFormExternalId?: string;
}
