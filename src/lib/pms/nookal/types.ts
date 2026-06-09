/**
 * Raw Nookal API response shapes (the subset we read/write).
 *
 * Field names VERIFIED (2026-06-09) against the working Elixir client
 * theo-agilelab/nookal-api (lib/nookal/{patient,appointment,practitioner,
 * location,document}.ex parser @mapping) + the Nookal object docs.
 *
 * Nookal returns every scalar as a STRING in JSON (ids, "1"/"0" booleans, dates)
 * — map.ts coerces at the boundary. Ids are kept as strings end to end
 * (provider-neutral; never Number()).
 *
 * ⚠️ getServices (appointment types) is NOT implemented by the reference client,
 * so its exact keys are the conventional ID/Name/Duration and MUST be verified
 * against a live account; see NookalService below.
 */

/**
 * Nookal envelope. Every endpoint returns HTTP 200; `status` is the real
 * success indicator. Results live under `data.results.<resourceKey>`.
 */
export interface NookalEnvelope<T = unknown> {
  status: "success" | "failure";
  data?: {
    results?: Record<string, T[] | string | undefined>;
  };
  details?: {
    totalItems?: string | number;
    currentItems?: string | number;
    /** Present on failure. */
    errorMessage?: string;
    errorCode?: string;
    errorDescription?: string;
  };
  settings?: {
    currentPage?: string | number | null;
    /** null on the last page → pagination terminator. */
    nextPage?: string | number | null;
    pageLength?: string | number | null;
  };
  /** Fallback error string some failures use. */
  error?: string;
}

/** Patient — keys: ID, Title, FirstName, …, DOB (YYYY-MM-DD), Mobile, Email. */
export interface NookalPatient {
  ID: string;
  Title?: string | null;
  FirstName?: string | null;
  MiddleName?: string | null;
  LastName?: string | null;
  Nickname?: string | null;
  DOB?: string | null; // YYYY-MM-DD
  Gender?: string | null;
  Email?: string | null;
  Mobile?: string | null;
  LocationID?: string | null;
  Addr1?: string | null;
  Addr2?: string | null;
  Addr3?: string | null;
  City?: string | null;
  State?: string | null;
  Country?: string | null;
  Postcode?: string | null;
  Occupation?: string | null;
  DateCreated?: string | null; // "YYYY-MM-DD HH:MM:SS"
  DateModified?: string | null; // "YYYY-MM-DD HH:MM:SS"
  // Nookal patients expose no archived/active flag (verified: no such key).
}

/**
 * Appointment — note the mixed-case keys and that booleans are "1"/"0" strings,
 * dates are split (appointmentDate = YYYY-MM-DD, times separate), and the
 * modified field is `lastModified` (not `dateModified`).
 */
export interface NookalAppointment {
  ID: string;
  patientID?: string | null;
  practitionerID?: string | null;
  locationID?: string | null;
  appointmentType?: string | null; // 'Consultation' | 'Class'
  appointmentTypeID?: string | null; // Service or Class id
  appointmentDate?: string | null; // YYYY-MM-DD
  appointmentStartTime?: string | null; // HH:MM(:SS)
  appointmentEndTime?: string | null;
  arrived?: string | null; // "1" | "0"
  cancelled?: string | null; // "1" | "0"
  cancellationDate?: string | null;
  DNA?: string | null; // "1" | "0" — did not arrive
  invoiceGenerated?: string | null;
  Notes?: string | null;
  dateCreated?: string | null;
  lastModified?: string | null; // "YYYY-MM-DD HH:MM:SS"
  TimeZone?: string | null; // IANA, e.g. "Australia/Brisbane"
  // Nookal provides the times pre-converted to UTC — PREFER these over the
  // local appointmentDate/Start/End fields, which are location-local (verified).
  appointmentStartDateTimeUTC?: string | null; // "YYYY-MM-DD HH:MM:SS" UTC
  appointmentEndDateTimeUTC?: string | null;
}

/** Practitioner — keys: ID, FirstName, LastName, Email, Speciality, Title. */
export interface NookalPractitioner {
  ID: string;
  FirstName?: string | null;
  LastName?: string | null;
  Title?: string | null;
  Email?: string | null;
  Speciality?: string | null;
  locations?: string[] | null; // array of location ids
}

/** Location → canonical PmsBusiness. Keys: ID, Name, Timezone. */
export interface NookalLocation {
  ID: string;
  Name?: string | null;
  Timezone?: string | null;
}

/**
 * Service → canonical PmsAppointmentType. VERIFIED against a live account:
 * `getAppointmentTypes` returns these under result key `services`.
 */
export interface NookalService {
  ID: string;
  Name?: string | null;
  Description?: string | null;
  Duration?: string | null; // minutes, e.g. "30"
  Category?: string | null;
  Price?: string | null;
  hasTax?: string | null;
  Locations?: Array<string | number> | null;
  ServiceCode?: string | null;
  active?: string | null; // "1" | "0"
}

// ── Write payloads ──

/**
 * editPatient WRITE params (snake_case — DIFFERENT from the read object's
 * PascalCase). Verified against the live docs/account: editPatient silently
 * ignores unknown params, so the casing must be exact.
 */
export interface NookalPatientPatch {
  first_name?: string;
  last_name?: string;
  date_of_birth?: string; // YYYY-MM-DD
  email?: string;
  mobile?: string;
  address_line_1?: string;
  city?: string;
  state?: string;
  postcode?: string;
}

/** uploadFile (step 1) result scalars (read from data.results). */
export interface NookalUploadInit {
  file_id: string;
  url: string;
}
