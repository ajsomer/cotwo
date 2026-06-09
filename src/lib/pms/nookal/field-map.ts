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
 * Keys are provider-namespaced ('nookal:...'). PATIENT_WRITE_PARAM/READ_FIELD
 * wire a catalogue key → editPatient's write param and getPatients' read field
 * (see the asymmetry note below).
 */

export const NOOKAL_PREFIX = "nookal:";

/**
 * ⚠️ Nookal's API is ASYMMETRIC (verified against a live account 2026-06-09):
 * - READS (getPatients) return PascalCase keys: DOB, Email, FirstName, Addr1…
 * - WRITES (editPatient) expect snake_case params: date_of_birth, email,
 *   first_name, address_line_1… (docs: api.nookal.com/dev/reference/patient)
 * editPatient silently IGNORES unknown params and still returns status:success,
 * so sending the read-casing no-ops with a false "written". Hence two maps:
 * WRITE_PARAM (→ editPatient param) and READ_FIELD (→ the value to read for the
 * fill-blanks check). Only fields editPatient documents as writable are
 * included — Gender/Title/Occupation are NOT documented as editable, so they're
 * excluded rather than silently dropped.
 */

/** Catalogue key → editPatient WRITE param name (snake_case). */
export const PATIENT_WRITE_PARAM: Record<string, keyof NookalPatientPatch> = {
  "nookal:patient.first_name": "first_name",
  "nookal:patient.last_name": "last_name",
  "nookal:patient.date_of_birth": "date_of_birth",
  "nookal:patient.email": "email",
  "nookal:patient.mobile": "mobile",
  "nookal:patient.address_1": "address_line_1",
  "nookal:patient.city": "city",
  "nookal:patient.state": "state",
  "nookal:patient.post_code": "postcode",
};

/** Catalogue key → getPatients READ field name (PascalCase) for fill-blanks. */
export const PATIENT_READ_FIELD: Record<string, string> = {
  "nookal:patient.first_name": "FirstName",
  "nookal:patient.last_name": "LastName",
  "nookal:patient.date_of_birth": "DOB",
  "nookal:patient.email": "Email",
  "nookal:patient.mobile": "Mobile",
  "nookal:patient.address_1": "Addr1",
  "nookal:patient.city": "City",
  "nookal:patient.state": "State",
  "nookal:patient.post_code": "Postcode",
};

export const NOOKAL_FIELD_CATALOGUE: PmsFieldCatalogueEntry[] = [
  // ── Patient fields (editPatient) — only documented-writable fields ──
  { key: "nookal:patient.first_name", group: "Patient", label: "First name", valueType: "text", writeMode: "patient_field" },
  { key: "nookal:patient.last_name", group: "Patient", label: "Last name", valueType: "text", writeMode: "patient_field" },
  { key: "nookal:patient.date_of_birth", group: "Patient", label: "Date of birth", valueType: "date", writeMode: "patient_field" },
  { key: "nookal:patient.email", group: "Patient", label: "Email", valueType: "text", writeMode: "patient_field" },
  { key: "nookal:patient.mobile", group: "Patient", label: "Mobile", valueType: "phone", writeMode: "patient_field" },
  { key: "nookal:patient.address_1", group: "Patient", label: "Address", valueType: "text", writeMode: "patient_field" },
  { key: "nookal:patient.city", group: "Patient", label: "City / suburb", valueType: "text", writeMode: "patient_field" },
  { key: "nookal:patient.state", group: "Patient", label: "State", valueType: "text", writeMode: "patient_field" },
  { key: "nookal:patient.post_code", group: "Patient", label: "Postcode", valueType: "text", writeMode: "patient_field" },
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
];

export function catalogueEntry(key: string): PmsFieldCatalogueEntry | undefined {
  return NOOKAL_FIELD_CATALOGUE.find((e) => e.key === key);
}
