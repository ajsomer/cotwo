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
