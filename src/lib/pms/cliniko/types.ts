/**
 * Raw Cliniko API response shapes (the subset we read/write).
 * Confirmed against docs.api.cliniko.com. See plan §3.
 *
 * Cliniko ids are integers in JSON; we treat them as strings everywhere in the
 * canonical layer for provider-neutrality, converting at the map boundary.
 */

/** Cliniko's list-envelope: { total_entries, <resource>: [...], links }. */
export interface ClinikoListEnvelope<T> {
  total_entries: number;
  links?: { self?: string; next?: string; previous?: string };
  // The resource array lives under a resource-named key; callers read it by key.
  [resourceKey: string]: T[] | number | object | undefined;
}

export interface ClinikoPatient {
  id: number;
  first_name: string | null;
  last_name: string | null;
  date_of_birth: string | null; // YYYY-MM-DD
  email: string | null;
  patient_phone_numbers?: Array<{ number: string; phone_type?: string }>;
  archived_at: string | null;
  updated_at: string;
}

export interface ClinikoPractitioner {
  id: number;
  first_name: string | null;
  last_name: string | null;
  title?: string | null;
  designation?: string | null;
  active: boolean;
  updated_at: string;
}

export interface ClinikoAppointmentType {
  id: number;
  name: string;
  duration_in_minutes: number | null;
  archived_at: string | null;
  updated_at: string;
}

export interface ClinikoBusiness {
  id: number;
  business_name: string | null;
  label?: string | null;
  time_zone: string | null;
  archived_at: string | null;
  updated_at: string;
}

export interface ClinikoIndividualAppointment {
  id: number;
  starts_at: string | null; // ISO 8601 UTC
  ends_at: string | null;
  cancelled_at: string | null;
  did_not_arrive: boolean | null;
  archived_at: string | null;
  updated_at: string;
  // Cliniko returns related resources as links objects, e.g.
  // patient: { links: { self: ".../patients/123" } }
  patient?: ClinikoRelatedLink;
  practitioner?: ClinikoRelatedLink;
  appointment_type?: ClinikoRelatedLink;
  business?: ClinikoRelatedLink;
}

export interface ClinikoRelatedLink {
  links?: { self?: string };
}

// ── Write payloads ──

/** Subset of PATCH /patients we may write (fill-blanks-only). */
export interface ClinikoPatientPatch {
  first_name?: string;
  last_name?: string;
  date_of_birth?: string;
  email?: string;
  address_1?: string;
  city?: string;
  state?: string;
  post_code?: string;
  country_code?: string;
  sex?: string;
  gender_identity?: string;
  pronouns?: string;
  title?: string;
  medicare?: string;
  medicare_reference_number?: string;
  dva_card_number?: string;
  occupation?: string;
  referral_source?: string;
  notes?: string;
  appointment_notes?: string;
}

/** A self-contained patient_form we POST/PATCH (no template needed). */
export interface ClinikoPatientFormPayload {
  patient_id: number;
  name: string;
  content: {
    sections: Array<{
      name: string;
      questions: Array<{
        name: string;
        type: "text" | "paragraph" | "date";
        required?: boolean;
        answer?: string;
      }>;
    }>;
  };
}

export interface ClinikoPatientForm {
  id: number;
}
