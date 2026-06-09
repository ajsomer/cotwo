import "server-only";
import type { PmsFieldCatalogueEntry } from "./adapter";

/**
 * Generate a "Patient Registration" form from a provider's field catalogue
 * (plan §6, §7a). Generic: one question per patient-field target, each with its
 * `pmsTarget` pre-set, so the clinic has a working write-back form immediately.
 *
 * Separate from "New Patient Intake" (clinical capture) — registration is the
 * PMS write-back surface. Editable like any other form afterwards.
 *
 * NOTE: this form intentionally does NOT include the locked identity page. The
 * intake journey confirms the patient's identity (phone OTP + contact match)
 * before the form renders, and the registration fields below already capture
 * first/last/DOB/email with PMS write-back bindings — so an identity page would
 * be a redundant section that doesn't write anything back.
 */
export function buildRegistrationFormSchema(
  catalogue: PmsFieldCatalogueEntry[]
): Record<string, unknown> {
  const patientTargets = catalogue.filter(
    (e) => e.writeMode === "patient_field"
  );

  const elements = patientTargets.map((e) => questionForEntry(e));

  return {
    title: "Patient Registration",
    pages: [
      {
        name: "registration",
        title: "Registration details",
        elements:
          elements.length > 0
            ? elements
            : [
                {
                  type: "html",
                  name: "__no_targets",
                  html: '<p style="margin:0;font-size:14px;color:#8A8985">This PMS exposes no patient fields to write back to.</p>',
                },
              ],
      },
    ],
  };
}

function questionForEntry(e: PmsFieldCatalogueEntry): Record<string, unknown> {
  const base: Record<string, unknown> = {
    name: questionName(e.key),
    title: e.label,
    pmsTarget: e.key,
  };

  switch (e.valueType) {
    case "date":
      return { ...base, type: "text", inputType: "date" };
    case "phone":
      return { ...base, type: "text", inputType: "tel" };
    case "longtext":
      return { ...base, type: "comment", rows: 2 };
    case "enum":
      return {
        ...base,
        type: "dropdown",
        choices: e.enumChoices ?? [],
      };
    default:
      return { ...base, type: "text" };
  }
}

/** Stable SurveyJS question name from a catalogue key. */
function questionName(key: string): string {
  // 'cliniko:patient.date_of_birth' → 'patient_date_of_birth'
  const afterColon = key.includes(":") ? key.slice(key.indexOf(":") + 1) : key;
  return afterColon.replace(/[^a-zA-Z0-9]+/g, "_");
}
