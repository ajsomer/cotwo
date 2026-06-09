import "server-only";
import { db } from "@/lib/db";
import {
  forms as formsT,
  formSubmissions,
  pmsPushFieldResults,
  sessions as sessionsT,
} from "@/lib/db/schema";
import { and, eq, isNotNull, sql } from "drizzle-orm";
import { collectPmsTargets } from "@/lib/survey/pms-target-schema";
import type { PmsFieldResult, PmsFormFieldInput } from "../types";
import {
  type PmsConnectionRow,
  adapterForConnection,
  getConnectionForLocation,
  isSyncActive,
} from "../connection";

export interface PushSubmissionResult {
  submissionId: string;
  formName: string;
  externalId?: string;
  fields: PmsFieldResult[];
  pushStatus: "sent" | "partial" | "failed";
}

export interface SessionPushResult {
  ok: boolean;
  /** True when the session's location has no sync-active PMS — no-op, the
   *  caller should fall back to plain completion (regression-safe, §6.1). */
  noPms: boolean;
  submissions: PushSubmissionResult[];
  error?: string;
}

/**
 * Push every PMS-bound form submission tied to a session's appointment.
 * Plan §6.1. Provider-agnostic — resolves the active adapter and hands it
 * { key, value } pairs; never branches on Cliniko.
 */
export async function pushSessionFormSubmissions(args: {
  sessionId: string;
}): Promise<SessionPushResult> {
  const [session] = await db
    .select({
      appointmentId: sessionsT.appointmentId,
      locationId: sessionsT.locationId,
    })
    .from(sessionsT)
    .where(eq(sessionsT.id, args.sessionId))
    .limit(1);

  if (!session) {
    return { ok: false, noPms: false, submissions: [], error: "Session not found." };
  }
  if (!session.appointmentId) {
    return { ok: true, noPms: false, submissions: [] };
  }
  return pushAppointmentFormSubmissions({
    appointmentId: session.appointmentId,
    locationId: session.locationId,
  });
}

/**
 * Appointment-keyed push (used by the intake handoff "Sync to {PMS}" action,
 * which is appointment-scoped). Pushes every PMS-bound form submission for the
 * appointment. Provider-agnostic.
 */
export async function pushAppointmentFormSubmissions(args: {
  appointmentId: string;
  locationId: string;
}): Promise<SessionPushResult> {
  const connection = await getConnectionForLocation(args.locationId);
  if (!connection || !isSyncActive(connection)) {
    return { ok: true, noPms: true, submissions: [] };
  }

  // Find PMS-bound form submissions for this appointment.
  const subs = await db
    .select({
      submissionId: formSubmissions.id,
      formId: formSubmissions.formId,
      formName: formsT.name,
      responses: formSubmissions.responses,
      schema: formsT.schema,
      patientId: formSubmissions.patientId,
      existingExternalId: formSubmissions.pmsExternalId,
    })
    .from(formSubmissions)
    .innerJoin(formsT, eq(formsT.id, formSubmissions.formId))
    .where(
      and(
        eq(formSubmissions.appointmentId, args.appointmentId),
        isNotNull(formsT.pmsProvider)
      )
    );

  const submissions: PushSubmissionResult[] = [];
  for (const sub of subs) {
    const result = await pushOneSubmission(connection, {
      submissionId: sub.submissionId,
      formName: sub.formName,
      responses: sub.responses as Record<string, unknown>,
      schema: sub.schema,
      patientId: sub.patientId,
    });
    submissions.push(result);
  }

  return { ok: true, noPms: false, submissions };
}

async function pushOneSubmission(
  connection: PmsConnectionRow,
  sub: {
    submissionId: string;
    formName: string;
    responses: Record<string, unknown>;
    schema: unknown;
    patientId: string;
  }
): Promise<PushSubmissionResult> {
  const adapter = adapterForConnection(connection)!;

  // Build the field input from pmsTarget bindings × submission responses.
  const targets = collectPmsTargets(sub.schema);
  const fields: PmsFormFieldInput[] = targets
    .map((t) => {
      const raw = sub.responses[t.questionName];
      return {
        questionName: t.questionName,
        targetKey: t.target,
        label: t.title || t.questionName,
        value: stringifyAnswer(raw),
      };
    })
    // Skip questions the patient left blank — nothing to write.
    .filter((f) => f.value !== "");

  if (fields.length === 0) {
    await persistResults(connection.provider, sub.submissionId, undefined, []);
    return {
      submissionId: sub.submissionId,
      formName: sub.formName,
      fields: [],
      pushStatus: "sent",
    };
  }

  const pushResult = await adapter.pushFormSubmission({
    connectionId: connection.id,
    patientId: sub.patientId,
    formName: sub.formName,
    fields,
  });

  await persistResults(
    connection.provider,
    sub.submissionId,
    pushResult.externalId,
    pushResult.fields
  );

  return {
    submissionId: sub.submissionId,
    formName: sub.formName,
    externalId: pushResult.externalId,
    fields: pushResult.fields,
    pushStatus: rollup(pushResult.fields),
  };
}

/**
 * Re-send a single corrected field from the §6.1 inline edit / retry. Reuses
 * the same adapter path; idempotent — PATCHes blank patient fields and the
 * existing patient_form (via the stored external id) rather than duplicating.
 */
export async function retryField(args: {
  submissionId: string;
  questionName: string;
  value: string;
}): Promise<{ ok: boolean; field?: PmsFieldResult; error?: string }> {
  const [sub] = await db
    .select({
      formId: formSubmissions.formId,
      patientId: formSubmissions.patientId,
      appointmentId: formSubmissions.appointmentId,
      existingExternalId: formSubmissions.pmsExternalId,
      schema: formsT.schema,
      formName: formsT.name,
    })
    .from(formSubmissions)
    .innerJoin(formsT, eq(formsT.id, formSubmissions.formId))
    .where(eq(formSubmissions.id, args.submissionId))
    .limit(1);

  if (!sub) return { ok: false, error: "Submission not found." };

  // Resolve the connection via the appointment's session location.
  const [sessionRow] = sub.appointmentId
    ? await db
        .select({ locationId: sessionsT.locationId })
        .from(sessionsT)
        .where(eq(sessionsT.appointmentId, sub.appointmentId))
        .limit(1)
    : [];
  if (!sessionRow) return { ok: false, error: "No session for submission." };

  const connection = await getConnectionForLocation(sessionRow.locationId);
  if (!connection || !isSyncActive(connection)) {
    return { ok: false, error: "No active PMS connection." };
  }
  const adapter = adapterForConnection(connection)!;

  const target = collectPmsTargets(sub.schema).find(
    (t) => t.questionName === args.questionName
  );
  if (!target) return { ok: false, error: "Field is no longer mapped." };

  const result = await adapter.pushFormSubmission({
    connectionId: connection.id,
    patientId: sub.patientId,
    formName: sub.formName,
    existingFormExternalId: sub.existingExternalId ?? undefined,
    fields: [
      {
        questionName: args.questionName,
        targetKey: target.target,
        label: target.title || args.questionName,
        value: args.value,
      },
    ],
  });

  await persistResults(
    connection.provider,
    args.submissionId,
    result.externalId,
    result.fields,
    /* bumpAttempts */ true
  );

  return { ok: true, field: result.fields[0] };
}

/** Persist per-field receipts + derive the coarse roll-up. Plan §8.G. */
async function persistResults(
  provider: string,
  submissionId: string,
  externalId: string | undefined,
  fields: PmsFieldResult[],
  bumpAttempts = false
): Promise<void> {
  for (const f of fields) {
    await db
      .insert(pmsPushFieldResults)
      .values({
        submissionId,
        provider: provider as "cliniko",
        surveyQuestionName: f.coviuQuestionName,
        pmsTargetKey: f.target,
        status: f.status,
        attemptedValue: f.attemptedValue,
        failureKind: f.failureKind ?? null,
        detail: f.detail ?? null,
      })
      .onConflictDoUpdate({
        target: [
          pmsPushFieldResults.submissionId,
          pmsPushFieldResults.surveyQuestionName,
        ],
        set: {
          status: f.status,
          attemptedValue: f.attemptedValue,
          failureKind: f.failureKind ?? null,
          detail: f.detail ?? null,
          attempts: bumpAttempts
            ? sql`${pmsPushFieldResults.attempts} + 1`
            : sql`${pmsPushFieldResults.attempts}`,
          updatedAt: new Date().toISOString(),
        },
      });
  }

  const status = rollup(fields);
  await db
    .update(formSubmissions)
    .set({
      pmsExternalId: externalId ?? undefined,
      pmsPushStatus: status,
      pmsPushedAt: new Date().toISOString(),
    })
    .where(eq(formSubmissions.id, submissionId));
}

function rollup(fields: PmsFieldResult[]): "sent" | "partial" | "failed" {
  const failed = fields.filter((f) => f.status === "failed").length;
  if (failed === 0) return "sent";
  const landed = fields.filter(
    (f) =>
      f.status === "written" ||
      f.status === "skipped_existing" ||
      f.status === "unmapped"
  ).length;
  return landed > 0 ? "partial" : "failed";
}

/** Stringify a SurveyJS answer for a single PMS field. */
function stringifyAnswer(raw: unknown): string {
  if (raw === null || raw === undefined) return "";
  if (typeof raw === "string") return raw.trim();
  if (typeof raw === "number" || typeof raw === "boolean") return String(raw);
  if (Array.isArray(raw)) return raw.map((x) => String(x)).join(", ");
  return JSON.stringify(raw);
}
