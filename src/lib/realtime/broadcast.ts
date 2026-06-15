/**
 * Realtime broadcast helpers.
 *
 * Server-side write paths call these after a DB mutation so connected clients
 * can refresh their state without polling. We use a loopback HTTP POST to
 * `/_internal/broadcast` (handled by `server.ts`) because the Socket.IO `io`
 * instance lives in the custom server's closure — it is not reachable from
 * Next.js App Router API routes, which run in isolated Webpack workers.
 *
 * Non-fatal on failure: we log and swallow so the caller's request still
 * completes even if the internal endpoint hiccups.
 */

export type SessionChangeEvent =
  | "arrived"
  | "joined"
  | "status_changed"
  | "session_created"
  | "session_updated"
  | "session_deleted";

export type SessionStatus =
  | "queued"
  | "waiting"
  | "checked_in"
  | "in_session"
  | "complete"
  | "done";

async function publish(
  room: string,
  event: string,
  payload: Record<string, unknown>
): Promise<void> {
  const port = process.env.PORT ?? "3000";
  const url = `http://127.0.0.1:${port}/_internal/broadcast`;
  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ room, event, payload }),
    });
  } catch (err) {
    console.error(`broadcast publish failed for ${room}/${event}:`, err);
  }
}

/**
 * Notify all clinic clients joined to a location that a session at that
 * location has changed. Triggers a sessions slice refresh on the run sheet.
 */
export async function broadcastSessionChange(
  locationId: string,
  event: SessionChangeEvent,
  payload: Record<string, unknown> = {}
): Promise<void> {
  await publish(`location:${locationId}`, "session_changed", { event, ...payload });
}

/**
 * Notify the patient waiting room (scoped to a single session) that the
 * session's status changed. Patient flips into the video call when the
 * clinician admits, closes out when the session completes, etc.
 */
export async function broadcastSessionStatus(
  sessionId: string,
  status: SessionStatus
): Promise<void> {
  await publish(`session:${sessionId}`, "status_changed", { sessionId, status });
}

/**
 * Notify all clinic staff connected to an org's room that a standalone form
 * submission was created or actioned. Used by the Readiness dashboard's
 * standalone-submissions section so reviewers see new submissions land in
 * real-time across all locations of the org.
 */
export type OrgSubmissionEvent =
  | "submission_created"
  | "submission_reviewed"
  | "submission_archived";

export async function broadcastOrgSubmissionChange(
  orgId: string,
  event: OrgSubmissionEvent,
  payload: Record<string, unknown> = {}
): Promise<void> {
  await publish(`org:${orgId}`, "submission_changed", { event, ...payload });
}

export type ReadinessChangeEvent =
  | "package_completed"
  | "package_transcribed"
  | "action_resolved"
  | "action_updated";

/**
 * Notify all clinic clients joined to a location that something on the
 * readiness dashboard has changed. Triggers a readiness slice refresh.
 * The discriminator + appointment_id are informational only — the client
 * refetches the whole readiness slice regardless.
 */
export async function broadcastReadinessChange(
  locationId: string,
  event: ReadinessChangeEvent,
  payload: Record<string, unknown> = {}
): Promise<void> {
  await publish(`location:${locationId}`, "readiness_changed", { event, ...payload });
}

/**
 * Discriminated caller→patient match resolved by the telephony webhook. Mirrors
 * `CallMatch` in `src/lib/telephony/patient-match.ts` (kept structurally in sync;
 * this layer stays free of a server-only import so it's safe in any context).
 */
export type IncomingCallMatch =
  | { kind: "patient"; patientId: string; number: string }
  | { kind: "multi"; patientIds: string[]; number: string }
  | { kind: "unknown"; number: string };

/**
 * Notify clinic clients at a location that a call was answered (call-pop test
 * trigger). The event is location-scoped — everyone in the room receives it —
 * so the client filters on `userId` (the configured demo target) before popping.
 * `callId` lets the client pair the open with its later `call_ended`.
 */
export async function broadcastIncomingCall(
  locationId: string,
  payload: { userId: string | null; callId: string; match: IncomingCallMatch }
): Promise<void> {
  await publish(`location:${locationId}`, "incoming_call", payload);
}

/** Notify that a call ended so the client closes the card it opened (by callId). */
export async function broadcastCallEnded(
  locationId: string,
  payload: { callId: string }
): Promise<void> {
  await publish(`location:${locationId}`, "call_ended", payload);
}
