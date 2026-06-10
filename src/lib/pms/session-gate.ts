import "server-only";
import { db } from "@/lib/db";
import {
  appointmentActions,
  appointments as appointmentsT,
  forms as formsT,
  formSubmissions,
  sessions as sessionsT,
  workflowActionBlocks,
} from "@/lib/db/schema";
import { and, eq, isNotNull } from "drizzle-orm";
import { collectPmsTargets } from "@/lib/survey/pms-target-schema";
import { getFactory, getStaticMetadata } from "./registry";
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
  /** Whether the provider can take the intake PDF (gates the attach half). */
  writeAttachments: boolean;
  /** At least one mapped field with a value (gates the field-push half). */
  hasPushableFields: boolean;
}

const INACTIVE: SessionPmsGate = {
  active: false,
  provider: null,
  providerLabel: null,
  writeAttachments: false,
  hasPushableFields: false,
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
  // The Done step's send only pushes form fields (no PDF attach), so its gate
  // stays field-driven: attachment-only doesn't light it up.
  return gateFor(session.appointmentId, session.locationId, {
    attachmentOnlyCounts: false,
  });
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
  // The handoff panel attaches the intake PDF as well as pushing fields, so an
  // attachment-capable provider with an intake package activates the gate even
  // with no mapped field data — that's the Nookal writeForms:false document
  // path (clinical free-text rides Documents/attachments).
  return gateFor(appointmentId, appt.locationId, {
    attachmentOnlyCounts: true,
  });
}

async function gateFor(
  appointmentId: string,
  locationId: string,
  opts: { attachmentOnlyCounts: boolean }
): Promise<SessionPmsGate> {
  // 1. Sync-active connection that can write something this surface can send.
  const connection = await getConnectionForLocation(locationId);
  if (!connection || !isSyncActive(connection)) return INACTIVE;
  const meta = getStaticMetadata(connection.provider);
  const caps = meta?.capabilities;
  const canWriteFields = Boolean(caps?.writeForms || caps?.writePatientFields);
  const canAttach = Boolean(
    opts.attachmentOnlyCounts && caps?.writeAttachments
  );
  if (!canWriteFields && !canAttach) return INACTIVE;

  // 2. At least one completed PMS-bound submission for this appointment with a
  //    mapped field that has a non-empty value.
  let hasPushable = false;
  if (canWriteFields) {
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
    hasPushable = subs.some((sub) => {
      const responses = (sub.responses ?? {}) as Record<string, unknown>;
      return collectPmsTargets(sub.schema).some((t) => {
        const v = responses[t.questionName];
        return v !== null && v !== undefined && String(v).trim() !== "";
      });
    });
  }

  // 3. No field data → still active when there's an intake package PDF to
  //    attach (and the surface sends attachments).
  const active =
    hasPushable || (canAttach && (await hasIntakePackage(appointmentId)));
  if (!active) return INACTIVE;

  return {
    active: true,
    provider: connection.provider,
    providerLabel: labelFor(connection.provider),
    writeAttachments: caps?.writeAttachments === true,
    hasPushableFields: hasPushable,
  };
}

/** Does this appointment have an intake_package action (= a PDF to attach)? */
async function hasIntakePackage(appointmentId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: appointmentActions.id })
    .from(appointmentActions)
    .innerJoin(
      workflowActionBlocks,
      eq(workflowActionBlocks.id, appointmentActions.actionBlockId)
    )
    .where(
      and(
        eq(appointmentActions.appointmentId, appointmentId),
        eq(workflowActionBlocks.actionType, "intake_package")
      )
    )
    .limit(1);
  return Boolean(row);
}

function labelFor(provider: string): string {
  return getFactory(provider)?.displayName ?? provider;
}
