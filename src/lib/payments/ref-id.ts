import { db } from "@/lib/db";
import { patients as patientsT } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

/**
 * Resolve a patient's stable provider customer ref (the Tyro `refId`).
 *
 * The refId is patient-level — the saved card follows the patient across visits,
 * so it must be the same every time. We derive a deterministic value from the
 * patient id (`coviu-<patientId>`) and persist it to patients.provider_customer_ref
 * on first use, so it's stable and queryable for reconciliation.
 */
export async function resolvePatientRefId(patientId: string): Promise<string> {
  const [row] = await db
    .select({ ref: patientsT.providerCustomerRef })
    .from(patientsT)
    .where(eq(patientsT.id, patientId));

  if (row?.ref) return row.ref;

  const refId = `coviu-${patientId}`;
  await db
    .update(patientsT)
    .set({ providerCustomerRef: refId })
    .where(eq(patientsT.id, patientId));

  return refId;
}
