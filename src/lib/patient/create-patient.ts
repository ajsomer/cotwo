import { db } from "@/lib/db";
import { patients as patientsT, patientPhoneNumbers } from "@/lib/db/schema";

export interface CreatePatientWithPhoneInput {
  orgId: string;
  firstName: string;
  lastName: string;
  /** Nullable — the entry flow's identity step doesn't always collect DOB. */
  dateOfBirth?: string | null;
  /**
   * Stored as given. Callers own normalisation: staff/patient flows pass the
   * E.164 result of `normalisePhone`; the onboarding test-session passes the
   * staff-typed number trimmed only (deliberate — it's a throwaway test
   * contact, kept as entered).
   */
  phoneNumber: string;
  /**
   * True only when the patient proved ownership of this number via OTP in the
   * current flow (patient entry identity step, standalone form submit). Staff-
   * entered numbers (readiness add-patient, onboarding test-session) are NOT
   * verified — they stamp no `verified_at`, so the entry flow still OTPs them.
   */
  phoneVerified: boolean;
  /** Console tag for error logs, e.g. "add-patient". */
  logTag: string;
}

export type CreatePatientWithPhoneResult =
  /**
   * Patient created. `phoneLinked: false` means the phone insert failed after
   * the patient row was written (already logged) — callers decide whether
   * that's fatal for their flow.
   */
  | { ok: true; patientId: string; phoneLinked: boolean }
  /** Patient insert itself failed (already logged). */
  | { ok: false };

/**
 * Create a brand-new patient and link their first phone number.
 *
 * One write path for the ~5 create-patient sites (patient entry identity,
 * standalone form submit ×2, readiness add-patient, onboarding test-session).
 * NOT for the PMS sync's `upsertPatient` (transactional create + external-id
 * link, conflict-upserted phones) or the demo seeds (fixed-UUID bulk upserts).
 *
 * Semantics decisions:
 * - `is_primary` is always true: this function only ever creates a NEW
 *   patient, so the linked number is their sole — and therefore primary —
 *   phone. Downstream contact resolution (workflow engine, run sheet SMS)
 *   reads the primary phone. Two historical sites (standalone submit) omitted
 *   the flag, but the column's DB default is true, so making it explicit
 *   converges the code without changing stored data.
 * - `verified_at` is stamped now() iff `phoneVerified` — see the field doc.
 */
export async function createPatientWithPhone(
  input: CreatePatientWithPhoneInput,
): Promise<CreatePatientWithPhoneResult> {
  let created: { id: string } | undefined;
  try {
    [created] = await db
      .insert(patientsT)
      .values({
        orgId: input.orgId,
        firstName: input.firstName,
        lastName: input.lastName,
        dateOfBirth: input.dateOfBirth ?? null,
      })
      .returning({ id: patientsT.id });
  } catch (patientError) {
    console.error(`[${input.logTag}] Failed to create patient:`, patientError);
    return { ok: false };
  }
  if (!created) {
    console.error(`[${input.logTag}] Patient insert returned no row`);
    return { ok: false };
  }

  try {
    await db.insert(patientPhoneNumbers).values({
      patientId: created.id,
      phoneNumber: input.phoneNumber,
      isPrimary: true,
      verifiedAt: input.phoneVerified ? new Date().toISOString() : null,
    });
  } catch (phoneError) {
    console.error(`[${input.logTag}] Failed to link phone:`, phoneError);
    return { ok: true, patientId: created.id, phoneLinked: false };
  }

  return { ok: true, patientId: created.id, phoneLinked: true };
}
