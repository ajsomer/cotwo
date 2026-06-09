import type { PmsFieldCatalogueEntry } from "../adapter";
import type { ClinikoPatientPatch } from "./types";

/**
 * STATIC Cliniko field catalogue (plan §6). Fixed and documented ahead of time
 * from the API docs — no per-clinic template introspection, no auto-generation.
 *
 * Keys are provider-namespaced ('cliniko:...'). Each entry declares how the
 * adapter writes it: `patient_field` → PATCH /patients; `form_answer` → a
 * question in a self-contained POST /patient_forms.
 *
 * The `patientPatchField` map (below) is the single source of truth wiring a
 * catalogue key to the concrete ClinikoPatientPatch property.
 */

export const CLINIKO_PREFIX = "cliniko:";

/** Cliniko's accepted `sex` values (verify against a live account at build). */
export const CLINIKO_SEX_VALUES = ["Female", "Male", "Intersex", "Not stated"];

/** Maps a patient-field catalogue key → the PATCH /patients property. */
export const PATIENT_PATCH_FIELD: Record<string, keyof ClinikoPatientPatch> = {
  "cliniko:patient.first_name": "first_name",
  "cliniko:patient.last_name": "last_name",
  "cliniko:patient.date_of_birth": "date_of_birth",
  "cliniko:patient.email": "email",
  "cliniko:patient.address_1": "address_1",
  "cliniko:patient.city": "city",
  "cliniko:patient.state": "state",
  "cliniko:patient.post_code": "post_code",
  "cliniko:patient.sex": "sex",
  "cliniko:patient.title": "title",
  "cliniko:patient.medicare": "medicare",
  "cliniko:patient.medicare_reference_number": "medicare_reference_number",
  "cliniko:patient.dva_card_number": "dva_card_number",
  "cliniko:patient.occupation": "occupation",
  "cliniko:patient.referral_source": "referral_source",
};

export const CLINIKO_FIELD_CATALOGUE: PmsFieldCatalogueEntry[] = [
  // ── Patient fields (PATCH /patients) ──
  { key: "cliniko:patient.first_name", group: "Patient", label: "First name", valueType: "text", writeMode: "patient_field" },
  { key: "cliniko:patient.last_name", group: "Patient", label: "Last name", valueType: "text", writeMode: "patient_field" },
  { key: "cliniko:patient.date_of_birth", group: "Patient", label: "Date of birth", valueType: "date", writeMode: "patient_field" },
  { key: "cliniko:patient.email", group: "Patient", label: "Email", valueType: "text", writeMode: "patient_field" },
  { key: "cliniko:patient.address_1", group: "Patient", label: "Address", valueType: "text", writeMode: "patient_field" },
  { key: "cliniko:patient.city", group: "Patient", label: "City / suburb", valueType: "text", writeMode: "patient_field" },
  { key: "cliniko:patient.state", group: "Patient", label: "State", valueType: "text", writeMode: "patient_field" },
  { key: "cliniko:patient.post_code", group: "Patient", label: "Postcode", valueType: "text", writeMode: "patient_field" },
  { key: "cliniko:patient.sex", group: "Patient", label: "Sex", valueType: "enum", enumChoices: CLINIKO_SEX_VALUES, writeMode: "patient_field" },
  { key: "cliniko:patient.title", group: "Patient", label: "Title", valueType: "text", writeMode: "patient_field" },
  { key: "cliniko:patient.medicare", group: "Patient", label: "Medicare number", valueType: "text", writeMode: "patient_field" },
  { key: "cliniko:patient.medicare_reference_number", group: "Patient", label: "Medicare ref. number", valueType: "text", writeMode: "patient_field" },
  { key: "cliniko:patient.dva_card_number", group: "Patient", label: "DVA card number", valueType: "text", writeMode: "patient_field" },
  { key: "cliniko:patient.occupation", group: "Patient", label: "Occupation", valueType: "text", writeMode: "patient_field" },
  { key: "cliniko:patient.referral_source", group: "Patient", label: "Referral source", valueType: "text", writeMode: "patient_field" },

  // ── Standalone form answers (POST /patient_forms) ──
  // Cliniko accepts answers only for text / paragraph / date question types,
  // so the catalogue exposes those value types for form answers (plan §8.G).
  { key: "cliniko:form.note", group: "Form answer", label: "Note / free text", valueType: "longtext", writeMode: "form_answer" },
  { key: "cliniko:form.reason_for_visit", group: "Form answer", label: "Reason for visit", valueType: "longtext", writeMode: "form_answer" },
  { key: "cliniko:form.medical_history", group: "Form answer", label: "Medical history", valueType: "longtext", writeMode: "form_answer" },
  { key: "cliniko:form.medications", group: "Form answer", label: "Current medications", valueType: "longtext", writeMode: "form_answer" },
  { key: "cliniko:form.allergies", group: "Form answer", label: "Allergies", valueType: "longtext", writeMode: "form_answer" },
];

/** The patient-field targets the seeded "Patient Registration" form uses (§6). */
export const CLINIKO_REGISTRATION_FIELDS: string[] = [
  "cliniko:patient.first_name",
  "cliniko:patient.last_name",
  "cliniko:patient.date_of_birth",
  "cliniko:patient.email",
  "cliniko:patient.address_1",
  "cliniko:patient.city",
  "cliniko:patient.state",
  "cliniko:patient.post_code",
  "cliniko:patient.sex",
  "cliniko:patient.medicare",
];

export function catalogueEntry(key: string): PmsFieldCatalogueEntry | undefined {
  return CLINIKO_FIELD_CATALOGUE.find((e) => e.key === key);
}
