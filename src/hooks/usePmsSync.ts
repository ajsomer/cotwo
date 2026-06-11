"use client";

import { useCallback, useState } from "react";

/**
 * Response body of POST /api/pms/sync. Note an HTTP-200 body can still carry
 * `ok: false` + `error`.
 */
export interface PmsSyncResponse {
  ok?: boolean;
  appointmentsUpserted?: number;
  sessionsScheduled?: number;
  skippedNonTelehealth?: number;
  error?: string;
}

interface UsePmsSyncOptions {
  locationId: string | null;
  /**
   * Builds the success line from the sync result. Defaults to the
   * run-sheet/readiness copy ("Synced — N new session(s), …").
   */
  successMessage?: (data: PmsSyncResponse) => string;
  /**
   * Runs (awaited, while the spinner is still active) after a successful
   * sync — each shell refreshes its own slice here.
   */
  onSynced?: (data: PmsSyncResponse) => void | Promise<void>;
  /** Runs after every attempt, success or failure (fire-and-forget). */
  onSettled?: () => void;
}

const defaultSuccessMessage = (data: PmsSyncResponse) =>
  `Synced — ${data.sessionsScheduled ?? 0} new session(s), ${data.appointmentsUpserted ?? 0} appointment(s) updated.`;

/**
 * Owns the "Sync now" request + `isSyncing`/`syncMsg` state that was
 * previously copy-pasted across the run-sheet, readiness, and integrations
 * shells. Uses a direct `fetch` rather than `postJson`: the handlers read
 * result-count fields and the `ok` flag off the body (beyond the `{ error }`
 * envelope postJson surfaces), and the offline copy is sync-specific.
 */
export function usePmsSync({
  locationId,
  successMessage,
  onSynced,
  onSettled,
}: UsePmsSyncOptions) {
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);

  const syncNow = useCallback(async () => {
    if (!locationId) return;
    setIsSyncing(true);
    setSyncMsg(null);
    try {
      const res = await fetch("/api/pms/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locationId }),
      });
      const data = (await res.json().catch(() => ({}))) as PmsSyncResponse;
      if (res.ok && data.ok) {
        setSyncMsg((successMessage ?? defaultSuccessMessage)(data));
        await onSynced?.(data);
      } else {
        setSyncMsg(data.error ?? "Sync failed.");
      }
    } catch {
      setSyncMsg("Couldn't reach the server.");
    } finally {
      setIsSyncing(false);
      onSettled?.();
    }
  }, [locationId, successMessage, onSynced, onSettled]);

  return { isSyncing, syncMsg, syncNow };
}
