/**
 * Identity page — the locked first page baked into every form's schema.
 *
 * Capture order: the identity page is page 0 of every standalone form. The
 * form author can see it in the builder but not edit or remove it (enforced
 * by the builder UI, not at the schema level — at the schema level it is
 * just a SurveyJS page with reserved names).
 *
 * Field naming convention:
 *   __identity_existing       — radiogroup of existing-match patient IDs +
 *                               "Someone else" sentinel. Only rendered when
 *                               the OTP step resolves matches; the runtime
 *                               injects choices and visibility dynamically.
 *   __identity_first_name     — text (visible if zero matches OR someone_else)
 *   __identity_last_name      — text
 *   __identity_date_of_birth  — date input
 *   __identity_email          — email input
 *
 * The runtime composer in `standalone-form-client.tsx` reads otp.matches +
 * verified phone and patches the radiogroup's choices / visibility at Model
 * instantiation. Server submit handler reads the resulting response payload
 * and composes the canonical `responses.patient_identity` snapshot.
 */

export const IDENTITY_PAGE_NAME = "__patient_identity";

export const IDENTITY_FIELD_NAMES = {
  existing: "__identity_existing",
  firstName: "__identity_first_name",
  lastName: "__identity_last_name",
  dateOfBirth: "__identity_date_of_birth",
  email: "__identity_email",
} as const;

/**
 * Build the static identity page that gets baked into a form's schema at
 * creation time. Does NOT include the existing-match radiogroup choices or
 * visibility rules — those depend on OTP results and are patched in by the
 * runtime composer. The four capture fields are present and visible by
 * default; the runtime hides them behind the radiogroup when matches exist.
 */
export function buildStaticIdentityPage(): Record<string, unknown> {
  return {
    name: IDENTITY_PAGE_NAME,
    title: "Your details",
    elements: [
      {
        type: "html",
        name: "__identity_intro",
        html: '<p style="margin:0 0 12px;font-size:14px;color:#8A8985">We need a few details so the clinic knows who you are.</p>',
      },
      {
        type: "text",
        name: IDENTITY_FIELD_NAMES.firstName,
        title: "First name",
        isRequired: true,
      },
      {
        type: "text",
        name: IDENTITY_FIELD_NAMES.lastName,
        title: "Last name",
        isRequired: true,
      },
      {
        type: "text",
        name: IDENTITY_FIELD_NAMES.dateOfBirth,
        inputType: "date",
        title: "Date of birth",
        isRequired: true,
      },
      {
        type: "text",
        name: IDENTITY_FIELD_NAMES.email,
        inputType: "email",
        title: "Email",
        isRequired: true,
      },
    ],
  };
}

/**
 * Default schema for a brand-new form. Identity page first, then one empty
 * author page so the builder shows an editable surface immediately.
 */
export function defaultFormSchema(): Record<string, unknown> {
  return {
    pages: [
      buildStaticIdentityPage(),
      {
        name: "page1",
        elements: [],
      },
    ],
  };
}

/**
 * Canonical seeded "New Patient Intake" form schema — the SAME form every
 * seeded clinic ships with (personal/contact captured on the locked identity
 * page, then emergency contact, Medicare details, medical history + consent).
 * Single source of truth so clinic setup, PMS setup, and any backfill all use
 * an identical form. Mirror of scripts/rebuild-templates.mjs's processed
 * output. A practice manager can edit it afterwards in the form builder.
 */
export function newPatientIntakeSchema(): Record<string, unknown> {
  return ensureIdentityPage({
    title: "New patient intake form",
    pages: [
      {
        name: IDENTITY_PAGE_NAME,
        title: "Your details",
        elements: [
          {
            type: "html",
            name: "__identity_intro",
            html: '<p style="margin:0 0 12px;font-size:14px;color:#8A8985">We need a few details so the clinic knows who you are.</p>',
          },
          { type: "text", name: IDENTITY_FIELD_NAMES.firstName, title: "First name", isRequired: true },
          { type: "text", name: IDENTITY_FIELD_NAMES.lastName, title: "Last name", isRequired: true },
          { type: "text", name: IDENTITY_FIELD_NAMES.dateOfBirth, inputType: "date", title: "Date of birth", isRequired: true },
          { type: "text", name: IDENTITY_FIELD_NAMES.email, inputType: "email", title: "Email", isRequired: true },
          { type: "text", name: "mobilePhone", inputType: "tel", title: "Mobile phone", isRequired: true },
          {
            type: "radiogroup",
            name: "gender",
            title: "Gender",
            choices: ["Male", "Female", "Non-binary", "Prefer not to say"],
            isRequired: true,
          },
          { type: "comment", name: "homeAddress", rows: 2, title: "Home address" },
        ],
      },
      {
        name: "emergency_contact",
        title: "Emergency contact",
        elements: [
          {
            type: "panel",
            name: "panel_emergency",
            elements: [
              { type: "text", name: "emergencyContactName", title: "Emergency contact name", isRequired: true },
              {
                type: "dropdown",
                name: "emergencyContactRelationship",
                title: "Relationship to you",
                choices: ["Partner", "Parent", "Sibling", "Child", "Friend", "Other"],
                isRequired: true,
              },
              { type: "text", name: "emergencyContactPhone", inputType: "tel", title: "Emergency contact phone", isRequired: true },
            ],
          },
        ],
      },
      {
        name: "medicare_details",
        title: "Medicare details",
        elements: [
          {
            type: "panel",
            name: "panel_medicare",
            elements: [
              { type: "text", name: "medicareNumber", title: "Medicare number" },
              { type: "text", name: "medicareIRN", title: "Reference number (IRN)", startWithNewLine: false },
              { type: "text", name: "medicareExpiry", title: "Expiry date", placeholder: "MM/YY" },
              { type: "text", name: "privateHealthFund", title: "Private health fund" },
              { type: "text", name: "privateHealthMemberNumber", title: "Member number", startWithNewLine: false },
            ],
          },
        ],
      },
      {
        name: "medical_history_consent",
        title: "Medical history and consent",
        elements: [
          {
            type: "panel",
            name: "panel_health",
            elements: [
              { type: "boolean", name: "hasConditions", title: "Do you have any current medical conditions?" },
              { type: "comment", name: "conditionsDescription", rows: 3, title: "Please describe your conditions", visibleIf: "{hasConditions} = true" },
              { type: "comment", name: "currentMedications", rows: 2, title: "Current medications" },
              { type: "comment", name: "allergies", rows: 2, title: "Allergies" },
            ],
          },
          {
            type: "panel",
            name: "panel_consent",
            elements: [
              { type: "boolean", name: "consentHealthInfo", title: "I consent to the collection and use of my health information for the purposes of my care", isRequired: true, requiredErrorText: "You must provide consent to continue" },
              { type: "boolean", name: "consentPrivacyPolicy", title: "I have read and understood the practice privacy policy", isRequired: true, requiredErrorText: "You must acknowledge the privacy policy to continue" },
            ],
          },
        ],
      },
    ],
  });
}

/**
 * Returns true if a schema already contains the identity page.
 */
export function hasIdentityPage(schema: unknown): boolean {
  if (!schema || typeof schema !== "object") return false;
  const pages = (schema as { pages?: unknown }).pages;
  if (!Array.isArray(pages)) return false;
  return pages.some(
    (p) =>
      typeof p === "object" &&
      p !== null &&
      (p as { name?: string }).name === IDENTITY_PAGE_NAME,
  );
}

/**
 * Prepend the identity page to a schema if it's not already present.
 * Idempotent — call freely from migrations / runtime / backfills.
 */
export function ensureIdentityPage(
  schema: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  const base = schema && typeof schema === "object" ? schema : {};
  if (hasIdentityPage(base)) return base as Record<string, unknown>;
  const existingPages = Array.isArray((base as { pages?: unknown }).pages)
    ? ((base as { pages: unknown[] }).pages as unknown[])
    : [];
  return {
    ...base,
    pages: [buildStaticIdentityPage(), ...existingPages],
  };
}
