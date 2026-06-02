/**
 * Custom Node server that runs Next.js + Socket.IO in the same process.
 *
 * The `io` instance lives ONLY in this module's closure. Next.js App Router
 * API routes run in isolated Webpack-bundled workers that do NOT share Node's
 * module cache with this process — importing `io` from them would resolve to
 * a separate, uninitialized module instance.
 *
 * API routes publish events by POSTing to the `/_internal/broadcast` endpoint
 * handled below (loopback-only). That hop is ~1ms and keeps `io` safe from
 * Next.js's worker isolation.
 */

// MUST be first: loads .env.local into process.env before any env-dependent
// module (neon-auth, db) is evaluated. See src/lib/load-env.ts.
import "@/lib/load-env";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import next from "next";
import { Server as SocketIOServer } from "socket.io";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { resolveSocketUserId } from "@/lib/auth/socket-session";
import {
  sessions as sessionsT,
  sessionParticipants,
  staffAssignments,
  locations as locationsT,
} from "@/lib/db/schema";

const dev = process.env.NODE_ENV !== "production";
const hostname = "0.0.0.0";
const port = Number(process.env.PORT ?? 3000);

const app = next({ dev, hostname, port });
const nextHandler = app.getRequestHandler();

async function main() {
  await app.prepare();

  const httpServer = createServer(async (req, res) => {
    // Intercept loopback broadcast posts from Next.js API routes.
    if (
      req.method === "POST" &&
      req.url === "/_internal/broadcast" &&
      isLoopback(req)
    ) {
      return handleInternalBroadcast(req, res);
    }

    return nextHandler(req, res);
  });

  const io = new SocketIOServer(httpServer, {
    // Same-origin by default; no CORS config needed in dev or on Railway.
  });

  // Socket auth middleware. Patient tabs (unauthenticated phone-OTP flow)
  // connect anonymously — fine, we only gate staff-only rooms. Staff tabs
  // have a Neon Auth session cookie; we validate it and stash the user's
  // allowed location IDs AND org IDs on `socket.data` so `join:location` and
  // `join:org` can both enforce membership without re-querying.
  io.use(async (socket, next) => {
    const cookieHeader = socket.handshake.headers.cookie ?? "";
    socket.data.userId = null;
    socket.data.allowedLocationIds = [] as string[];
    socket.data.allowedOrgIds = [] as string[];

    if (!cookieHeader) return next();

    try {
      // Validate the Neon Auth session from the handshake cookie. We're outside
      // a Next request scope here (the socket server runs under tsx, not the
      // App Router), so we can't use auth.getSession() — its local path reads
      // cookies via next/headers, which throws outside a request. resolveSocket-
      // UserId forwards the cookie to the auth server's /get-session endpoint
      // instead. Mirrors getAuthenticatedUserId() in staff-access.ts.
      const userId = await resolveSocketUserId(cookieHeader);

      if (userId) {
        socket.data.userId = userId;

        // Resolve allowed locations + orgs from staff_assignments → locations.
        // Same membership rule the HTTP staff gates enforce (staff-access.ts),
        // kept identical so socket-room access can't drift from route access.
        const assignments = await db
          .select({
            location_id: staffAssignments.locationId,
            org_id: locationsT.orgId,
          })
          .from(staffAssignments)
          .innerJoin(locationsT, eq(locationsT.id, staffAssignments.locationId))
          .where(eq(staffAssignments.userId, userId));

        socket.data.allowedLocationIds = assignments.map((a) => a.location_id);

        const orgIds = new Set<string>();
        for (const a of assignments) {
          if (a.org_id) orgIds.add(a.org_id);
        }
        socket.data.allowedOrgIds = Array.from(orgIds);
      }
    } catch (err) {
      console.warn("[socket] auth middleware error:", err);
    }

    next();
  });

  // Presence tracking.
  //
  // `activeLocations` is the canonical view: locationId -> (sessionId -> Set<socketId>).
  // A sessionId is "connected" at a location as long as any socket still claims
  // it. Tolerates multiple tabs per patient and brief reconnects.
  //
  // `socketReverseMap` is a reverse lookup so that on `disconnect` (where we
  // only know the socket.id) we can find the (locationId, sessionId) to clean
  // up in O(1) instead of scanning every location.
  const activeLocations = new Map<string, Map<string, Set<string>>>();
  const socketReverseMap = new Map<
    string,
    { locationId: string; sessionId: string }
  >();

  function broadcastPresence(locationId: string) {
    const sessionsInLocation = activeLocations.get(locationId);
    const sessionIds = sessionsInLocation
      ? Array.from(sessionsInLocation.keys())
      : [];
    io.to(`location:${locationId}`).emit("presence:update", { sessionIds });
  }

  /**
   * Resolve a patient `entry_token` to the session it belongs to, server-side.
   *
   * Patient sockets are anonymous, so the only proof they can offer that they
   * own a session is the unguessable entry token from their URL. We resolve it
   * here and bind the result to `socket.data.session` ONCE — every later
   * presence/join emit reuses that bound claim rather than trusting the
   * payload, so a forged emit can't point the socket at another session (which
   * previously allowed deleting another patient's on-demand session on
   * disconnect, see cleanUpOnDemandSession).
   */
  async function resolveEntryToken(
    token: string
  ): Promise<{ sessionId: string; locationId: string } | null> {
    try {
      const [row] = await db
        .select({ id: sessionsT.id, location_id: sessionsT.locationId })
        .from(sessionsT)
        .where(eq(sessionsT.entryToken, token))
        .limit(1);
      if (!row) return null;
      return { sessionId: row.id, locationId: row.location_id };
    } catch (err) {
      console.warn("[socket] entry token resolve error:", err);
      return null;
    }
  }

  /**
   * Establish (once) the session claim for a patient socket from its entry
   * token, caching it on `socket.data.session`. Returns the bound claim, or
   * null if the token doesn't resolve. Idempotent: a socket that already has a
   * claim keeps it (the claim is immutable for the socket's lifetime).
   */
  async function bindSocketSession(
    socket: import("socket.io").Socket,
    entryToken: unknown
  ): Promise<{ sessionId: string; locationId: string } | null> {
    if (socket.data.session) return socket.data.session;
    if (typeof entryToken !== "string" || !entryToken) return null;
    const resolved = await resolveEntryToken(entryToken);
    if (!resolved) return null;
    socket.data.session = resolved;
    return resolved;
  }

  io.on("connection", (socket) => {
    console.log("[socket] connected:", socket.id);

    socket.on("join:location", (locationId: string) => {
      if (typeof locationId !== "string" || !locationId) return;
      const allowed: string[] = socket.data.allowedLocationIds ?? [];
      if (!allowed.includes(locationId)) {
        console.warn(
          `[socket] ${socket.id} denied join:location ${locationId} (user=${socket.data.userId ?? "anon"})`
        );
        return;
      }
      socket.join(`location:${locationId}`);
      console.log(`[socket] ${socket.id} joined location:${locationId}`);
      // Send the current presence set to the newly-joined clinic client.
      broadcastPresence(locationId);
    });

    // Clinic staff only. Joins the org-wide room for events that aren't
    // location-scoped (e.g. standalone form submissions, future org-wide
    // notifications). Membership is resolved server-side from the
    // staff_assignments → locations.org_id chain at connection time.
    // Patient flows never join org rooms.
    socket.on("join:org", (orgId: string) => {
      if (typeof orgId !== "string" || !orgId) return;
      const allowed: string[] = socket.data.allowedOrgIds ?? [];
      if (!allowed.includes(orgId)) {
        console.warn(
          `[socket] ${socket.id} denied join:org ${orgId} (user=${socket.data.userId ?? "anon"})`
        );
        return;
      }
      socket.join(`org:${orgId}`);
      console.log(`[socket] ${socket.id} joined org:${orgId}`);
    });

    // Patient-side: join a session room so server-emitted status changes
    // reach the waiting room without any polling. The socket proves ownership
    // with its entry token; the resolved session id is taken from the bound
    // claim, never from the payload.
    socket.on("join:session", async (payload: { entryToken?: string }) => {
      const claim = await bindSocketSession(socket, payload?.entryToken);
      if (!claim) return;
      socket.join(`session:${claim.sessionId}`);
    });

    // Patient-side: claim presence for the socket's own session. Called from
    // the waiting room with its entry token. The (location, session) pair is
    // resolved server-side from the token and bound to the socket, so a forged
    // emit cannot claim presence for — or, on disconnect, delete — another
    // patient's session. Idempotent across repeat emits from the same socket.
    socket.on("presence:track", async (payload: { entryToken?: string }) => {
      const claim = await bindSocketSession(socket, payload?.entryToken);
      if (!claim) return;
      const { locationId, sessionId } = claim;

      // The claim is immutable once bound, so a socket can only ever register
      // presence for its own session — no prior-claim teardown is needed.
      socketReverseMap.set(socket.id, { locationId, sessionId });

      let locMap = activeLocations.get(locationId);
      if (!locMap) {
        locMap = new Map();
        activeLocations.set(locationId, locMap);
      }
      let sockets = locMap.get(sessionId);
      if (!sockets) {
        sockets = new Set();
        locMap.set(sessionId, sockets);
      }
      sockets.add(socket.id);

      console.log(
        `[socket] presence:track ${socket.id} location=${locationId} session=${sessionId}`
      );
      broadcastPresence(locationId);
    });

    socket.on("disconnect", (reason) => {
      console.log(`[socket] ${socket.id} disconnected: ${reason}`);

      const presence = socketReverseMap.get(socket.id);
      if (!presence) return;

      const { locationId, sessionId } = presence;
      const locMap = activeLocations.get(locationId);
      let lastSocketForSession = false;
      if (locMap) {
        const sockets = locMap.get(sessionId);
        sockets?.delete(socket.id);
        if (sockets && sockets.size === 0) {
          locMap.delete(sessionId);
          lastSocketForSession = true;
        }
        if (locMap.size === 0) activeLocations.delete(locationId);
      }
      socketReverseMap.delete(socket.id);
      broadcastPresence(locationId);

      // On-demand sessions (no appointment) that are still waiting can be
      // removed when the patient disconnects — they have no scheduled context
      // worth keeping on the run sheet.
      if (lastSocketForSession) {
        void cleanUpOnDemandSession(sessionId, locationId);
      }
    });
  });

  /**
   * Delete on-demand sessions (no appointment) that are still in `waiting`
   * when the patient disconnects. These have no scheduled context — they were
   * created on the fly and aren't worth keeping on the run sheet.
   */
  async function cleanUpOnDemandSession(sessionId: string, locationId: string) {
    try {
      // Only delete if the session is on-demand (no appointment) and still waiting.
      const [session] = await db
        .select({
          id: sessionsT.id,
          appointment_id: sessionsT.appointmentId,
          status: sessionsT.status,
        })
        .from(sessionsT)
        .where(eq(sessionsT.id, sessionId))
        .limit(1);

      if (!session) return;
      if (session.appointment_id !== null) return; // scheduled session — keep it
      if (session.status !== "waiting") return;    // already admitted/completed — keep it

      // Clean up participant links first, then delete the session.
      await db
        .delete(sessionParticipants)
        .where(eq(sessionParticipants.sessionId, sessionId));

      await db.delete(sessionsT).where(eq(sessionsT.id, sessionId));

      console.log(`[cleanup] Deleted on-demand session ${sessionId} (patient disconnected)`);

      // Notify clinic clients so the row disappears from the run sheet.
      io.to(`location:${locationId}`).emit("session_changed", {
        event: "session_deleted",
        session_id: sessionId,
      });
    } catch (err) {
      console.error(`[cleanup] Error cleaning up on-demand session ${sessionId}:`, err);
    }
  }

  function handleInternalBroadcast(req: IncomingMessage, res: ServerResponse) {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk.toString();
      // Safety: reject absurdly large payloads
      if (body.length > 10_000) {
        res.writeHead(413).end("payload too large");
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        const { room, event, payload } = JSON.parse(body) as {
          room: string;
          event: string;
          payload: unknown;
        };
        if (!room || !event) {
          res.writeHead(400).end("room and event required");
          return;
        }
        io.to(room).emit(event, payload);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      } catch (err) {
        console.error("[server] /_internal/broadcast error:", err);
        res.writeHead(400).end("invalid json");
      }
    });
  }

  httpServer.listen(port, hostname, () => {
    console.log(`> Ready on http://${hostname}:${port}`);
  });
}

function isLoopback(req: IncomingMessage): boolean {
  const addr = req.socket.remoteAddress ?? "";
  return addr === "127.0.0.1" || addr === "::1" || addr === "::ffff:127.0.0.1";
}

main().catch((err) => {
  console.error("[server] fatal:", err);
  process.exit(1);
});
