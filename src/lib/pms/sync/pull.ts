import "server-only";
import { db } from "@/lib/db";
import {
  appointments,
  appointmentWorkflowRuns,
  patients,
  patientPhoneNumbers,
  sessions,
} from "@/lib/db/schema";
import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { scheduleWorkflowForAppointment } from "@/lib/workflows/scanner";
import type { PmsAdapter } from "../adapter";
import type { PmsAppointment, PmsPatient } from "../types";
import {
  type PmsConnectionRow,
  adapterForConnection,
  orgForLocation,
  recordSyncResult,
} from "../connection";
import { getCursor, setCursor } from "./cursor";
import {
  getPatientIdByExternal,
  getRoomByPractitionerExternal,
  getTypeLinkByExternal,
  linkPatient,
} from "./mapping";

export interface PullResult {
  ok: boolean;
  patients: number;
  appointmentsUpserted: number;
  sessionsScheduled: number;
  cancelled: number;
  skippedNonTelehealth: number;
  reconciled: number;
  error?: string;
}

/**
 * One full incremental read sync for a connection. Plan §5.
 *
 * Dependency order: businesses/practitioners/types are mapped via the Settings
 * surfaces (we don't auto-create clinicians/locations here — those are explicit
 * mappings). The pull focuses on the moving data: patients then appointments.
 * Appointment types must already be CONFIRMED telehealth + sync_enabled + room
 * for an appointment to reach the run sheet.
 */
export async function pullConnection(
  connection: PmsConnectionRow
): Promise<PullResult> {
  const adapter = adapterForConnection(connection);
  if (!adapter) {
    return emptyResult({ ok: false, error: "Connection is not sync-active." });
  }
  const orgId = await orgForLocation(connection.locationId);
  if (!orgId) {
    return emptyResult({ ok: false, error: "Location has no org." });
  }

  const result: PullResult = emptyResult({ ok: true });

  try {
    // 1. Patients (changed since cursor) → upsert + link.
    result.patients = await pullPatients(adapter, connection, orgId);

    // 2. Appointments (changed since cursor) → upsert + schedule workflow.
    const apptResult = await pullAppointments(adapter, connection, orgId);
    result.appointmentsUpserted = apptResult.upserted;
    result.sessionsScheduled = apptResult.scheduled;
    result.cancelled = apptResult.cancelled;
    result.skippedNonTelehealth = apptResult.skipped;

    // 3. Reconcile: re-pull any synced appointment whose patient went missing
    //    in Coviu (e.g. deleted locally). The incremental cursor would never
    //    re-surface them on its own, so we heal them here. Cliniko wins.
    result.reconciled = await reconcileMissingPatients(adapter, connection, orgId);

    await recordSyncResult(connection.id, null);
  } catch (e) {
    result.ok = false;
    result.error = (e as Error).message;
    await recordSyncResult(connection.id, result.error ?? "unknown error");
  }

  return result;
}

// ───────────────────────────── Patients ─────────────────────────────

async function pullPatients(
  adapter: PmsAdapter,
  connection: PmsConnectionRow,
  orgId: string
): Promise<number> {
  const since = (await getCursor(connection.id, "patients")) ?? undefined;
  let count = 0;
  let maxUpdated: Date | null = null;

  for await (const p of adapter.listPatients({ since })) {
    await upsertPatient(connection.id, orgId, p);
    count++;
    // We don't get updated_at on the canonical PmsPatient; advance to now after.
  }
  // Patients lack an updated_at in the canonical shape; bump cursor to now so
  // the next run only re-reads genuinely newer records.
  if (count > 0) maxUpdated = new Date();
  if (maxUpdated) await setCursor(connection.id, "patients", maxUpdated);
  return count;
}

async function upsertPatient(
  connectionId: string,
  orgId: string,
  p: PmsPatient
): Promise<void> {
  // Already linked? Update the existing Coviu patient.
  const existingId = await getPatientIdByExternal(connectionId, p.externalId);

  let patientId: string;
  if (existingId) {
    await db
      .update(patients)
      .set({
        firstName: p.firstName || "Unknown",
        lastName: p.lastName || "",
        dateOfBirth: p.dateOfBirth,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(patients.id, existingId));
    patientId = existingId;
  } else {
    const [created] = await db
      .insert(patients)
      .values({
        orgId,
        firstName: p.firstName || "Unknown",
        lastName: p.lastName || "",
        dateOfBirth: p.dateOfBirth,
      })
      .returning({ id: patients.id });
    patientId = created.id;
    await linkPatient(connectionId, patientId, p.externalId);
  }

  // Phone numbers — upsert each (unique on patient_id + phone_number). The
  // workflow engine (and the run sheet) resolve a patient's contact via the
  // PRIMARY phone, so the patient needs one or add_to_runsheet fails with "No
  // phone number on file". Mark the first synced number primary when the
  // patient has none yet; never clobber an existing clinic-set primary.
  const [existingPrimary] = await db
    .select({ id: patientPhoneNumbers.id })
    .from(patientPhoneNumbers)
    .where(
      and(
        eq(patientPhoneNumbers.patientId, patientId),
        eq(patientPhoneNumbers.isPrimary, true)
      )
    )
    .limit(1);
  let hasPrimary = Boolean(existingPrimary);

  for (const phone of p.phoneNumbers) {
    if (!phone?.trim()) continue;
    const makePrimary = !hasPrimary;
    await db
      .insert(patientPhoneNumbers)
      .values({ patientId, phoneNumber: phone.trim(), isPrimary: makePrimary })
      .onConflictDoNothing();
    if (makePrimary) hasPrimary = true;
  }
}

// ─────────────────────────── Appointments ───────────────────────────

async function pullAppointments(
  adapter: PmsAdapter,
  connection: PmsConnectionRow,
  orgId: string
): Promise<{ upserted: number; scheduled: number; cancelled: number; skipped: number }> {
  const since = (await getCursor(connection.id, "appointments")) ?? undefined;
  let upserted = 0;
  let scheduled = 0;
  let cancelled = 0;
  let skipped = 0;
  let maxUpdated: Date | null = null;

  for await (const a of adapter.listAppointments({
    since,
    businessId: connection.defaultBusinessExternalId ?? undefined,
  })) {
    const updated = a.updatedAt ? new Date(a.updatedAt) : null;
    if (updated && (!maxUpdated || updated > maxUpdated)) maxUpdated = updated;

    const outcome = await upsertAppointment(adapter, connection, orgId, a);
    if (outcome === "skipped") skipped++;
    else {
      upserted++;
      if (outcome === "scheduled") scheduled++;
      if (outcome === "cancelled") cancelled++;
    }
  }

  if (maxUpdated) await setCursor(connection.id, "appointments", maxUpdated);
  return { upserted, scheduled, cancelled, skipped };
}

type ApptOutcome = "scheduled" | "updated" | "cancelled" | "skipped";

async function upsertAppointment(
  adapter: PmsAdapter,
  connection: PmsConnectionRow,
  orgId: string,
  a: PmsAppointment
): Promise<ApptOutcome> {
  if (!a.appointmentTypeExternalId) return "skipped";

  // Resolve the type link — only CONFIRMED telehealth + sync_enabled types
  // reach the run sheet (plan §5). The type link is the source of truth for
  // import state (§8.E/H); room comes from the practitioner mapping (§025).
  const typeLink = await getTypeLinkByExternal(
    connection.id,
    a.appointmentTypeExternalId
  );
  // Type gate: confirmed telehealth + sync enabled (§5). Modality/sync are
  // confirmed on the type in Workflows; the type no longer carries a room.
  if (
    !typeLink ||
    !typeLink.syncEnabled ||
    typeLink.confirmedModality !== "telehealth"
  ) {
    return "skipped";
  }

  // Room comes from the practitioner→room mapping (§025): the appointment-book
  // column decides which room the patient lands in. No practitioner mapped to a
  // room → we can't place the appointment, so skip it.
  const roomId = a.practitionerExternalId
    ? await getRoomByPractitionerExternal(connection.id, a.practitionerExternalId)
    : null;
  if (!roomId) {
    return "skipped";
  }

  // Resolve the Coviu patient. If the appointment references a patient that
  // isn't linked yet (e.g. the incremental patient sweep already advanced past
  // them, or the patient was deleted), fetch + upsert + link on demand so the
  // appointment never lands patient-less (which would fail add_to_runsheet).
  let patientId = a.patientExternalId
    ? await getPatientIdByExternal(connection.id, a.patientExternalId)
    : null;
  if (!patientId && a.patientExternalId) {
    const pmsPatient = await adapter.getPatient(a.patientExternalId);
    if (pmsPatient) {
      await upsertPatient(connection.id, orgId, pmsPatient);
      patientId = await getPatientIdByExternal(connection.id, a.patientExternalId);
    }
  }

  // Find an existing synced appointment for this (location, external id).
  const [existing] = await db
    .select({ id: appointments.id, status: appointments.status })
    .from(appointments)
    .where(
      and(
        eq(appointments.locationId, connection.locationId),
        eq(appointments.pmsExternalId, a.externalId)
      )
    )
    .limit(1);

  const status = a.cancelled
    ? ("cancelled" as const)
    : a.didNotArrive
      ? ("no_show" as const)
      : ("scheduled" as const);

  if (existing) {
    await db
      .update(appointments)
      .set({
        patientId: patientId ?? undefined,
        appointmentTypeId: typeLink.appointmentTypeId,
        roomId,
        scheduledAt: a.startsAt,
        status,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(appointments.id, existing.id));

    // Reschedule/cancel handling: cascade cancellation to the session and drop
    // pending workflow actions. (Reschedule of scheduled_at is reflected above;
    // future-dated add_to_runsheet fires off the new time on the next scan.)
    if (status === "cancelled" || status === "no_show") {
      await cancelSessionFor(existing.id);
      return "cancelled";
    }
    return "updated";
  }

  // New appointment. Cancelled/no-show on first sight: record it, no session.
  const [created] = await db
    .insert(appointments)
    .values({
      orgId,
      locationId: connection.locationId,
      patientId: patientId ?? undefined,
      appointmentTypeId: typeLink.appointmentTypeId,
      roomId,
      scheduledAt: a.startsAt,
      status,
      pmsExternalId: a.externalId,
    })
    .onConflictDoNothing({
      target: [appointments.locationId, appointments.pmsExternalId],
      // The unique index is PARTIAL (WHERE pms_external_id IS NOT NULL), so the
      // conflict target must repeat that predicate or Postgres can't match it
      // ("no unique or exclusion constraint matching the ON CONFLICT spec").
      where: sql`${appointments.pmsExternalId} IS NOT NULL`,
    })
    .returning({ id: appointments.id });

  if (!created) return "updated"; // lost a race; another run inserted it

  if (status === "cancelled" || status === "no_show") return "cancelled";

  // Schedule the pre-appointment workflow so the appointment reaches the run
  // sheet via the add_to_runsheet action (plan §5). Requires a type_workflow_link.
  await scheduleWorkflowForAppointment(
    created.id,
    typeLink.appointmentTypeId,
    a.startsAt
  );
  return "scheduled";
}

/**
 * Heal synced appointments whose patient went missing in Coviu (e.g. deleted
 * locally). The incremental cursor won't re-surface them, so we re-fetch each
 * from Cliniko, re-create + re-link the patient (Cliniko wins), update the
 * appointment, and schedule the workflow if it still has no session.
 */
async function reconcileMissingPatients(
  adapter: PmsAdapter,
  connection: PmsConnectionRow,
  orgId: string
): Promise<number> {
  // Synced appointments at this location with no linked patient.
  const orphans = await db
    .select({
      id: appointments.id,
      pmsExternalId: appointments.pmsExternalId,
      appointmentTypeId: appointments.appointmentTypeId,
      scheduledAt: appointments.scheduledAt,
    })
    .from(appointments)
    .where(
      and(
        eq(appointments.locationId, connection.locationId),
        isNotNull(appointments.pmsExternalId),
        isNull(appointments.patientId)
      )
    );

  let healed = 0;
  for (const o of orphans) {
    if (!o.pmsExternalId) continue;
    const pmsAppt = await adapter.getAppointment(o.pmsExternalId);
    if (!pmsAppt?.patientExternalId) continue;

    // Re-create + link the patient from Cliniko.
    const pmsPatient = await adapter.getPatient(pmsAppt.patientExternalId);
    if (!pmsPatient) continue;
    await upsertPatient(connection.id, orgId, pmsPatient);
    const patientId = await getPatientIdByExternal(
      connection.id,
      pmsAppt.patientExternalId
    );
    if (!patientId) continue;

    await db
      .update(appointments)
      .set({ patientId, updatedAt: new Date().toISOString() })
      .where(eq(appointments.id, o.id));

    // If the appointment never spawned a session AND has no workflow run yet,
    // schedule the workflow now that it has a patient (add_to_runsheet needs
    // the patient's phone). Guarding on the run avoids duplicate runs when an
    // earlier run's add_to_runsheet failed (e.g. the missing-phone case).
    const [hasSession] = await db
      .select({ id: sessions.id })
      .from(sessions)
      .where(eq(sessions.appointmentId, o.id))
      .limit(1);
    const [hasRun] = await db
      .select({ id: appointmentWorkflowRuns.id })
      .from(appointmentWorkflowRuns)
      .where(eq(appointmentWorkflowRuns.appointmentId, o.id))
      .limit(1);
    if (!hasSession && !hasRun && o.appointmentTypeId) {
      await scheduleWorkflowForAppointment(
        o.id,
        o.appointmentTypeId,
        o.scheduledAt
      );
    }
    healed++;
  }
  return healed;
}

/** Cascade a cancelled/no-show appointment to its live session(s). */
async function cancelSessionFor(appointmentId: string): Promise<void> {
  await db
    .update(sessions)
    .set({ status: "done", updatedAt: new Date().toISOString() })
    .where(
      and(
        eq(sessions.appointmentId, appointmentId),
        // Don't disturb sessions already complete/done.
        sql`${sessions.status} NOT IN ('complete', 'done')`
      )
    );
}

function emptyResult(over: Partial<PullResult> & { ok: boolean }): PullResult {
  return {
    patients: 0,
    appointmentsUpserted: 0,
    sessionsScheduled: 0,
    cancelled: 0,
    skippedNonTelehealth: 0,
    reconciled: 0,
    ...over,
  };
}
