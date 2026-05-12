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
