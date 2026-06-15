import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { patientPhoneNumbers, patients } from "@/lib/db/schema";
import { normalisePhone } from "@/lib/phone/normalise";

/**
 * Resolve an inbound caller number to patient(s) at an org.
 *
 * Shared with the OTP identity flow's join shape (`patient_phone_numbers` ⋈
 * `patients`, scoped by `patients.org_id`), but phrased for the call-pop:
 * the caller number arrives in whatever format the phone system sends, so we
 * normalise to E.164 first (the canonical stored form — see normalisePhone).
 *
 * Returns a discriminated match the socket layer forwards to the run sheet:
 *   - `unknown`  → 0 matches, or an anonymous/withheld caller id
 *   - `patient`  → exactly 1
 *   - `multi`    → 2+ (multi-contact resolution; same chooser as the entry flow)
 */

export type CallMatch =
  | { kind: "patient"; patientId: string; number: string }
  | { kind: "multi"; patientIds: string[]; number: string }
  | { kind: "unknown"; number: string };

export async function matchCaller(
  orgId: string,
  rawNumber: string | null | undefined
): Promise<CallMatch> {
  const number = normalisePhone(rawNumber);
  // Withheld / anonymous / unparseable caller id → unknown, but still surface
  // whatever we were given so the panel can show "Unknown caller".
  if (!number) {
    return { kind: "unknown", number: rawNumber?.trim() || "Unknown" };
  }

  const rows = await db
    .select({ patientId: patients.id })
    .from(patientPhoneNumbers)
    .innerJoin(patients, eq(patients.id, patientPhoneNumbers.patientId))
    .where(
      and(
        eq(patientPhoneNumbers.phoneNumber, number),
        eq(patients.orgId, orgId)
      )
    );

  if (rows.length === 0) return { kind: "unknown", number };
  if (rows.length === 1) {
    return { kind: "patient", patientId: rows[0].patientId, number };
  }
  return { kind: "multi", patientIds: rows.map((r) => r.patientId), number };
}
