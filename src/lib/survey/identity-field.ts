/**
 * Identity contract for standalone forms.
 *
 * Identity is captured as a *locked* page automatically prepended to every
 * standalone form's SurveyJS schema by the patient runtime. Form authors
 * cannot add, remove, or reorder it — it is a platform responsibility, not
 * something the author drags in from the toolbox.
 *
 * This module defines the canonical response-payload key (`patient_identity`)
 * and the snapshot type the server writes into `form_submissions.responses`
 * on submit. See docs/specs/standalone-forms-spec.md for the full contract.
 */

export const IDENTITY_QUESTION_NAME = "patient_identity";

export interface IdentitySnapshot {
  first_name: string;
  last_name: string;
  date_of_birth: string;
  email: string;
  phone: string;
  resolved_patient_id: string;
  resolution_kind: "existing" | "someone_else" | "new";
}
