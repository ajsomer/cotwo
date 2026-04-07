import { createServiceClient } from "@/lib/supabase/service";
import type { PreconditionConfig } from "./types";

/**
 * Evaluate a precondition for a given appointment and patient.
 * Returns true if the action should fire, false if it should be skipped.
 *
 * null precondition = "Always fires" = returns true.
 */
export async function evaluatePrecondition(
  precondition: PreconditionConfig,
  appointmentId: string,
  patientId: string
): Promise<boolean> {
  // null = always fires
  if (!precondition) return true;

  const supabase = createServiceClient();

  switch (precondition.type) {
    case "form_not_completed": {
      // Check if the patient has a completed form_assignment for this form
      const { data } = await supabase
        .from("form_assignments")
        .select("id")
        .eq("patient_id", patientId)
        .eq("form_id", precondition.form_id)
        .eq("status", "completed")
        .limit(1);

      // Fire if NO completed assignment exists
      return (data ?? []).length === 0;
    }

    case "card_not_on_file": {
      // Check if the patient has any payment methods
      const { data } = await supabase
        .from("payment_methods")
        .select("id")
        .eq("patient_id", patientId)
        .limit(1);

      // Fire if NO payment methods exist
      return (data ?? []).length === 0;
    }

    case "contact_not_verified": {
      // Check if the patient has a verified phone number
      const { data } = await supabase
        .from("patient_phone_numbers")
        .select("verified_at")
        .eq("patient_id", patientId)
        .not("verified_at", "is", null)
        .limit(1);

      // Fire if NO verified phone numbers exist
      return (data ?? []).length === 0;
    }

    case "no_future_appointment": {
      // Check if the patient has any future appointments
      const { data } = await supabase
        .from("appointments")
        .select("id")
        .eq("patient_id", patientId)
        .gt("scheduled_at", new Date().toISOString())
        .neq("id", appointmentId) // exclude the current appointment
        .limit(1);

      // Fire if NO future appointments exist
      return (data ?? []).length === 0;
    }

    default:
      // Unknown precondition type — fire the action (safe default)
      console.warn(
        `[WORKFLOW] Unknown precondition type: ${(precondition as { type: string }).type}. Firing action.`
      );
      return true;
  }
}
