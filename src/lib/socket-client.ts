"use client";

import { io, type Socket } from "socket.io-client";

let socket: Socket | null = null;

/**
 * Lazily create (and cache) a single Socket.IO client connection for this tab.
 * Uses same-origin, so it works in dev and on Railway without URL config.
 */
export function getSocket(): Socket {
  if (socket) return socket;

  socket = io({
    autoConnect: true,
    // Prefer WebSocket; fall back to polling on networks that block WS.
    transports: ["websocket", "polling"],
  });

  socket.on("connect", () => {
    console.log("[socket] connected:", socket?.id);
  });
  socket.on("disconnect", (reason) => {
    console.log("[socket] disconnected:", reason);
  });
  socket.on("connect_error", (err) => {
    console.warn("[socket] connect_error:", err.message);
  });

  return socket;
}
