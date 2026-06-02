import { db } from "@/lib/db";
import {
  formAssignments,
  paymentMethods,
  patientPhoneNumbers,
  appointments as appointmentsT,
} from "@/lib/db/schema";
import { and, eq, gt, ne, isNotNull } from "drizzle-orm";
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

  switch (precondition.type) {
    case "form_not_completed": {
      // Check if the patient has a completed form_assignment for this form
      const data = await db
        .select({ id: formAssignments.id })
        .from(formAssignments)
        .where(
          and(
            eq(formAssignments.patientId, patientId),
            eq(formAssignments.formId, precondition.form_id),
            eq(formAssignments.status, "completed")
          )
        )
        .limit(1);

      // Fire if NO completed assignment exists
      return data.length === 0;
    }

    case "card_not_on_file": {
      // Check if the patient has any payment methods
      const data = await db
        .select({ id: paymentMethods.id })
        .from(paymentMethods)
        .where(eq(paymentMethods.patientId, patientId))
        .limit(1);

      // Fire if NO payment methods exist
      return data.length === 0;
    }

    case "contact_not_verified": {
      // Check if the patient has a verified phone number
      const data = await db
        .select({ verified_at: patientPhoneNumbers.verifiedAt })
        .from(patientPhoneNumbers)
        .where(
          and(
            eq(patientPhoneNumbers.patientId, patientId),
            isNotNull(patientPhoneNumbers.verifiedAt)
          )
        )
        .limit(1);

      // Fire if NO verified phone numbers exist
      return data.length === 0;
    }

    case "no_future_appointment": {
      // Check if the patient has any future appointments
      const data = await db
        .select({ id: appointmentsT.id })
        .from(appointmentsT)
        .where(
          and(
            eq(appointmentsT.patientId, patientId),
            gt(appointmentsT.scheduledAt, new Date().toISOString()),
            ne(appointmentsT.id, appointmentId) // exclude the current appointment
          )
        )
        .limit(1);

      // Fire if NO future appointments exist
      return data.length === 0;
    }

    default:
      // Unknown precondition type — fire the action (safe default)
      console.warn(
        `[WORKFLOW] Unknown precondition type: ${(precondition as { type: string }).type}. Firing action.`
      );
      return true;
  }
}
