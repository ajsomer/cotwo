import type { PmsFieldCatalogueEntry } from "../adapter";
import type { NookalPatientPatch } from "./types";

/**
 * STATIC Nookal field catalogue (plan §5). Patient-field targets only.
 *
 * writeForms is FALSE for v1 (plan §5, finding 2): Nookal's only form-answer
 * sink is addTreatmentNote, which requires case_id + practitioner_id that the
 * canonical PmsFormSubmissionInput cannot resolve safely. So the catalogue
 * exposes NO `form_answer` entries — only `patient_field` writes via the
 * patient-update endpoint. Clinical free-text rides the Documents/attachment
 * path instead.
 *
 * Keys are provider-namespaced ('nookal:...'). PATIENT_PATCH_FIELD is the single
 * source of truth wiring a catalogue key → the concrete NookalPatientPatch prop.
 *
 * ⚠️ The exact accepted patient-update field set must be verified against a live
 * account; validateField + per-field retry surface any rejection actionably.
 */

export const NOOKAL_PREFIX = "nookal:";

/** Maps a patient-field catalogue key → the patient-update property. */
export const PATIENT_PATCH_FIELD: Record<string, keyof NookalPatientPatch> = {
  "nookal:patient.first_name": "FirstName",
  "nookal:patient.last_name": "LastName",
  "nookal:patient.date_of_birth": "DOB",
  "nookal:patient.email": "Email",
  "nookal:patient.mobile": "Mobile",
  "nookal:patient.address_1": "Addr1",
  "nookal:patient.city": "City",
  "nookal:patient.state": "State",
  "nookal:patient.post_code": "Postcode",
  "nookal:patient.gender": "Gender",
  "nookal:patient.title": "Title",
  "nookal:patient.occupation": "Occupation",
};

/** Nookal's accepted `Gender` values (verify against a live account). */
export const NOOKAL_GENDER_VALUES = ["Male", "Female", "Other"];

export const NOOKAL_FIELD_CATALOGUE: PmsFieldCatalogueEntry[] = [
  // ── Patient fields (patient-update endpoint) ──
  { key: "nookal:patient.first_name", group: "Patient", label: "First name", valueType: "text", writeMode: "patient_field" },
  { key: "nookal:patient.last_name", group: "Patient", label: "Last name", valueType: "text", writeMode: "patient_field" },
  { key: "nookal:patient.date_of_birth", group: "Patient", label: "Date of birth", valueType: "date", writeMode: "patient_field" },
  { key: "nookal:patient.email", group: "Patient", label: "Email", valueType: "text", writeMode: "patient_field" },
  { key: "nookal:patient.mobile", group: "Patient", label: "Mobile", valueType: "phone", writeMode: "patient_field" },
  { key: "nookal:patient.address_1", group: "Patient", label: "Address", valueType: "text", writeMode: "patient_field" },
  { key: "nookal:patient.city", group: "Patient", label: "City / suburb", valueType: "text", writeMode: "patient_field" },
  { key: "nookal:patient.state", group: "Patient", label: "State", valueType: "text", writeMode: "patient_field" },
  { key: "nookal:patient.post_code", group: "Patient", label: "Postcode", valueType: "text", writeMode: "patient_field" },
  { key: "nookal:patient.gender", group: "Patient", label: "Gender", valueType: "enum", enumChoices: NOOKAL_GENDER_VALUES, writeMode: "patient_field" },
  { key: "nookal:patient.title", group: "Patient", label: "Title", valueType: "text", writeMode: "patient_field" },
  { key: "nookal:patient.occupation", group: "Patient", label: "Occupation", valueType: "text", writeMode: "patient_field" },
];

/** The patient-field targets the seeded "Patient Registration" form uses (§5). */
export const NOOKAL_REGISTRATION_FIELDS: string[] = [
  "nookal:patient.first_name",
  "nookal:patient.last_name",
  "nookal:patient.date_of_birth",
  "nookal:patient.email",
  "nookal:patient.mobile",
  "nookal:patient.address_1",
  "nookal:patient.city",
  "nookal:patient.state",
  "nookal:patient.post_code",
  "nookal:patient.gender",
];

export function catalogueEntry(key: string): PmsFieldCatalogueEntry | undefined {
  return NOOKAL_FIELD_CATALOGUE.find((e) => e.key === key);
}
