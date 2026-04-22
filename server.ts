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

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import next from "next";
import { Server as SocketIOServer } from "socket.io";
import { createServerClient } from "@supabase/ssr";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

const dev = process.env.NODE_ENV !== "production";
const hostname = process.env.HOSTNAME ?? "0.0.0.0";
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
  // have a Supabase session cookie; we validate it and stash the user's
  // allowed location IDs on `socket.data` so `join:location` can enforce
  // membership.
  io.use(async (socket, next) => {
    const cookieHeader = socket.handshake.headers.cookie ?? "";
    socket.data.userId = null;
    socket.data.allowedLocationIds = [] as string[];

    if (!cookieHeader) return next();

    try {
      const cookieMap = parseCookieHeader(cookieHeader);
      const supabase = createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
          cookies: {
            getAll: () =>
              Object.entries(cookieMap).map(([name, value]) => ({
                name,
                value,
              })),
            // Socket middleware has no response to set cookies on. The auth
            // library only reads during getUser(); writes (token refresh)
            // happen over regular HTTP request paths, not here.
            setAll: () => {},
          },
        }
      );

      const { data, error } = await supabase.auth.getUser();
      if (!error && data.user) {
        socket.data.userId = data.user.id;
        const { data: assignments } = await supabase
          .from("staff_assignments")
          .select("location_id")
          .eq("user_id", data.user.id);
        socket.data.allowedLocationIds = (assignments ?? []).map(
          (a: { location_id: string }) => a.location_id
        );
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

    // Patient-side: join a session room so server-emitted status changes
    // reach the waiting room without any polling.
    socket.on("join:session", (sessionId: string) => {
      if (typeof sessionId !== "string" || !sessionId) return;
      socket.join(`session:${sessionId}`);
    });

    // Patient-side: claim presence for a given session. Called from the
    // waiting room. Idempotent across repeat emits from the same socket.
    socket.on(
      "presence:track",
      (payload: { locationId?: string; sessionId?: string }) => {
        const { locationId, sessionId } = payload ?? {};
        if (
          typeof locationId !== "string" ||
          !locationId ||
          typeof sessionId !== "string" ||
          !sessionId
        ) {
          return;
        }

        // If this socket already had a presence claim (different session or
        // location), clear the old one first before setting the new claim.
        const prior = socketReverseMap.get(socket.id);
        if (
          prior &&
          (prior.locationId !== locationId || prior.sessionId !== sessionId)
        ) {
          const priorLoc = activeLocations.get(prior.locationId);
          const priorSockets = priorLoc?.get(prior.sessionId);
          priorSockets?.delete(socket.id);
          if (priorSockets && priorSockets.size === 0) {
            priorLoc!.delete(prior.sessionId);
          }
          if (priorLoc && priorLoc.size === 0) {
            activeLocations.delete(prior.locationId);
          }
          broadcastPresence(prior.locationId);
        }

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
      }
    );

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
      const supabase = createSupabaseClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
      );

      // Only delete if the session is on-demand (no appointment) and still waiting.
      const { data: session } = await supabase
        .from("sessions")
        .select("id, appointment_id, status")
        .eq("id", sessionId)
        .single();

      if (!session) return;
      if (session.appointment_id !== null) return; // scheduled session — keep it
      if (session.status !== "waiting") return;    // already admitted/completed — keep it

      // Clean up participant links first, then delete the session.
      await supabase
        .from("session_participants")
        .delete()
        .eq("session_id", sessionId);

      const { error } = await supabase
        .from("sessions")
        .delete()
        .eq("id", sessionId);

      if (error) {
        console.error(`[cleanup] Failed to delete on-demand session ${sessionId}:`, error);
        return;
      }

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

function parseCookieHeader(header: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const piece of header.split(";")) {
    const eq = piece.indexOf("=");
    if (eq < 0) continue;
    const name = piece.slice(0, eq).trim();
    const value = piece.slice(eq + 1).trim();
    if (name) out[name] = decodeURIComponent(value);
  }
  return out;
}

main().catch((err) => {
  console.error("[server] fatal:", err);
  process.exit(1);
});
