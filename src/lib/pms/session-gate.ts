import "server-only";
import { db } from "@/lib/db";
import {
  appointments as appointmentsT,
  forms as formsT,
  formSubmissions,
  sessions as sessionsT,
} from "@/lib/db/schema";
import { and, eq, isNotNull } from "drizzle-orm";
import { collectPmsTargets } from "@/lib/survey/pms-target-schema";
import { getStaticMetadata } from "./registry";
import { getConnectionForLocation, isSyncActive } from "./connection";

/**
 * The §6.1 gate, refined: the Process flow Done step shows "Sync to {PMS}" only
 * when this session actually has PUSHABLE FIELD DATA — i.e. a sync-active
 * connection that can write, AND at least one completed PMS-bound form
 * submission with a mapped (pmsTarget) field that has a value.
 *
 * A form with no pmsTarget bindings (or a session with no such submission, or
 * one where every mapped field is blank) is NOT a send candidate → the Done
 * step completes plainly. Connection existence alone is not enough.
 */
export interface SessionPmsGate {
  active: boolean;
  provider: string | null;
  providerLabel: string | null;
}

const INACTIVE: SessionPmsGate = {
  active: false,
  provider: null,
  providerLabel: null,
};

export async function getSessionPmsGate(
  sessionId: string
): Promise<SessionPmsGate> {
  const [session] = await db
    .select({
      locationId: sessionsT.locationId,
      appointmentId: sessionsT.appointmentId,
    })
    .from(sessionsT)
    .where(eq(sessionsT.id, sessionId))
    .limit(1);
  if (!session?.appointmentId) return INACTIVE;
  return gateFor(session.appointmentId, session.locationId);
}

/** Same gate, keyed on an appointment (used by the intake handoff panel). */
export async function getAppointmentPmsGate(
  appointmentId: string
): Promise<SessionPmsGate> {
  const [appt] = await db
    .select({ locationId: appointmentsT.locationId })
    .from(appointmentsT)
    .where(eq(appointmentsT.id, appointmentId))
    .limit(1);
  if (!appt) return INACTIVE;
  return gateFor(appointmentId, appt.locationId);
}

async function gateFor(
  appointmentId: string,
  locationId: string
): Promise<SessionPmsGate> {
  // 1. Sync-active connection that can write.
  const connection = await getConnectionForLocation(locationId);
  if (!connection || !isSyncActive(connection)) return INACTIVE;
  const meta = getStaticMetadata(connection.provider);
  const caps = meta?.capabilities;
  if (!caps?.writeForms && !caps?.writePatientFields) return INACTIVE;

  // 2. At least one completed PMS-bound submission for this appointment with a
  //    mapped field that has a non-empty value.
  const subs = await db
    .select({ responses: formSubmissions.responses, schema: formsT.schema })
    .from(formSubmissions)
    .innerJoin(formsT, eq(formsT.id, formSubmissions.formId))
    .where(
      and(
        eq(formSubmissions.appointmentId, appointmentId),
        isNotNull(formsT.pmsProvider)
      )
    );

  const hasPushable = subs.some((sub) => {
    const responses = (sub.responses ?? {}) as Record<string, unknown>;
    return collectPmsTargets(sub.schema).some((t) => {
      const v = responses[t.questionName];
      return v !== null && v !== undefined && String(v).trim() !== "";
    });
  });
  if (!hasPushable) return INACTIVE;

  return {
    active: true,
    provider: connection.provider,
    providerLabel: labelFor(connection.provider),
  };
}

function labelFor(provider: string): string {
  return provider.charAt(0).toUpperCase() + provider.slice(1);
}
