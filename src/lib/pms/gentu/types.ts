/**
 * Raw Gentu (Magentus) API shapes — the read/write SUBSET we actually touch,
 * not the whole OpenAPI surface. FHIR-flavoured and verbose; map.ts absorbs all
 * of this so the canonical layer never sees it.
 *
 * Sources: the Bookings + Healthcare specs, transcribed in
 * docs/architecture/gentu-bookings-healthcare-api.md. Every id is a UUID string.
 *
 * Read shapes come from the Healthcare API; the patient WRITE shape (patch)
 * comes from the Bookings API and differs from the read shape (notably contact
 * `system` drops `fax`, and names go through the extension array) — see §4 / §6a
 * of the reference doc.
 */

// ───────────────────────── Shared sub-shapes ─────────────────────────

/** Contact point. Reads allow system ∈ email|fax|phone; WRITES drop fax. */
export interface GentuContact {
  system: "email" | "fax" | "phone";
  use: "home" | "work" | "mobile";
  rank: number | null;
  value: string | null;
}

export interface GentuAddress {
  city: string | null;
  line: (string | null)[];
  postalCode: string | null;
  state: string | null;
  use: string;
  type: string;
}

/** Patient name. `given` holds given names INCLUDING middle ("Joey Doe Boe"). */
export interface GentuName {
  family: string;
  given: string | null;
  prefix: string | null;
}

/**
 * Patient `extension` entry — a discriminated bag. We only read the name
 * components; the typed identifier union (Medicare/DVA/etc.) is deferred (§6a).
 */
export interface GentuExtensionEntry {
  system:
    | "firstname"
    | "middlename"
    | "maiden-name"
    | "pronouns"
    | "emergency-contacts"
    | string;
  valueString?: string | null;
  valueArray?: unknown[];
}

/** Patient as the Healthcare API returns it (read shape). */
export interface GentuPatient {
  id: string;
  name: GentuName;
  birthDate: string | null;
  contact: GentuContact[];
  address: GentuAddress[] | null;
  gender: "female" | "male" | "unspecified" | null;
  occupation: string | null;
  emailEnabled: boolean;
  smsEnabled: boolean | null;
  deceased: { deceasedBoolean: boolean | null } | null;
  extension: GentuExtensionEntry[];
}

/** Appointment participant — links the appointment to patient/provider/etc. */
export interface GentuAppointmentParticipant {
  referenceType: "patient" | "provider" | "location" | "health_care_service";
  referenceId: string;
  arrivedAt?: string;
}

/** Appointment as the Healthcare API returns it. NO updatedAt field exists. */
export interface GentuAppointment {
  id: string;
  startAt: string;
  endAt: string | null;
  /** e.g. none|confirmed|completed|in_waiting_room|with_doctor|invoiced|cancelled|did_not_arrive */
  status: string | null;
  minutesDuration: number | null;
  participant: GentuAppointmentParticipant[];
  appointmentType: { reference: string | null };
}

/** The appointment list response (Healthcare), with optional side-loads. */
export interface GentuAppointmentListResponse {
  appointments: GentuAppointment[];
  pagination: { next: string | null; limit: number };
  /** Present when include=patients|practitioners|referrals was requested. */
  patients?: GentuPatient[];
  practitioners?: GentuUser[];
}

/** Practitioner / user. */
export interface GentuUser {
  id: string;
  name: GentuName;
  contact?: GentuContact[];
  active?: boolean;
  shownInAppointmentBook?: boolean;
}

/** Appointment type. */
export interface GentuAppointmentType {
  id: string;
  text: string;
  duration: number | null;
  colour: string | null;
  onlineBookable: boolean;
}

/** Site of service (the location-concept candidate — §2 item 4). */
export interface GentuSite {
  id: string;
  name: string | null;
}

/** Tenant (practice) row from GET /v1/tenants. */
export interface GentuTenant {
  tenantId: string;
  tenantAccess: "enabled" | "disabled";
}

/** Attachment status from GET .../attachments/{id} (async upload polling). */
export interface GentuAttachmentStatus {
  status:
    | "accepted"
    | "scanned_infected"
    | "scanned_clean"
    | "failed"
    | "completed";
  fileName: string;
  id: string;
}

/** Response from PUT .../attachments (async; poll status next). */
export interface GentuAttachmentUploadResponse {
  message: string;
  attachmentId: string;
}

// ───────────────────────── Write shapes (Bookings) ─────────────────────────

/**
 * Patient PATCH body (Bookings). PATCH/merge — recommend GET-first. Names go
 * via the extension entries (mutually exclusive with name.given); contact
 * `system` is email|phone ONLY (no fax) restricted to the allowed (system,use)
 * tuples. We only ever send the keys for blank fields we're filling.
 */
export interface GentuPatientPatch {
  name?: { family?: string; prefix?: string | null };
  birthDate?: string | null;
  gender?: "female" | "male" | "unspecified" | null;
  occupation?: string | null;
  address?: Array<{
    city?: string | null;
    line?: string[];
    postalCode?: string | null;
    state?: string | null;
    use: "home";
    type: "postal" | "physical";
  }>;
  contact?: Array<{
    system: "email" | "phone";
    use: "home" | "work" | "mobile";
    rank: number;
    value: string | null;
  }>;
  extension?: Array<{
    system: "firstname" | "middlename" | "maiden-name" | "pronouns";
    valueString: string | null;
  }>;
}
