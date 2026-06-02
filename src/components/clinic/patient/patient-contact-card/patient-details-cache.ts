import type { PatientSummaryResponse, PatientHistoryResponse } from "./types";

// Shared client-side caches for the patient contact card's two fetches, keyed
// by the route URL. The panel reads from them on open; a hover/pointer-down on
// the patient name warms them via prefetchPatientDetails so the data is often
// already present by the time the card animates in. 30s TTL — reopening the
// same patient is instant.
const CACHE_TTL_MS = 30_000;

export const summaryCache = new Map<
  string,
  { expiresAt: number; data: PatientSummaryResponse }
>();
export const historyCache = new Map<
  string,
  { expiresAt: number; data: PatientHistoryResponse }
>();

// In-flight prefetches, so a hover that fires before the click doesn't kick
// off a second identical request when the panel opens. Cleared on settle.
const inFlight = new Map<string, Promise<unknown>>();
const MAX_CONCURRENT_PREFETCHES = 3;
let activePrefetches = 0;

// URL builders — single source of truth so the panel loader and the prefetch
// site produce byte-identical URLs (cache hits depend on exact match).
export function patientSummaryUrl(
  patientId: string,
  activeAppointmentId: string | null,
): string {
  const qs = activeAppointmentId ? `?appointment_id=${activeAppointmentId}` : "";
  return `/api/patient/${patientId}/summary${qs}`;
}

export function patientHistoryUrl(
  patientId: string,
  activeAppointmentId: string | null,
  activeSessionId: string | null,
): string {
  const params = new URLSearchParams();
  if (activeSessionId) params.set("session_id", activeSessionId);
  if (activeAppointmentId) params.set("appointment_id", activeAppointmentId);
  const qs = params.toString();
  return `/api/patient/${patientId}/history${qs ? `?${qs}` : ""}`;
}

export function cacheSummary(url: string, data: PatientSummaryResponse): void {
  summaryCache.set(url, { data, expiresAt: Date.now() + CACHE_TTL_MS });
}

export function cacheHistory(url: string, data: PatientHistoryResponse): void {
  historyCache.set(url, { data, expiresAt: Date.now() + CACHE_TTL_MS });
}

/**
 * Warm both patient-card fetches on intent (hover / pointer-down of a patient
 * name). No-op if already cached/in-flight or if the concurrency cap is hit.
 * Only ok responses are cached; failures fall through to a normal fetch on
 * open. The panel reads these caches on open and skips the network entirely
 * when the prefetch has landed.
 */
export function prefetchPatientDetails(
  patientId: string,
  activeAppointmentId: string | null,
  activeSessionId: string | null,
): void {
  const summaryUrl = patientSummaryUrl(patientId, activeAppointmentId);
  const historyUrl = patientHistoryUrl(
    patientId,
    activeAppointmentId,
    activeSessionId,
  );

  warm(summaryUrl, summaryCache, cacheSummary);
  warm(historyUrl, historyCache, cacheHistory);
}

function warm<T>(
  url: string,
  cache: Map<string, { expiresAt: number; data: T }>,
  store: (url: string, data: T) => void,
): void {
  const cached = cache.get(url);
  if (cached && cached.expiresAt > Date.now()) return;
  if (inFlight.has(url)) return;
  if (activePrefetches >= MAX_CONCURRENT_PREFETCHES) return;

  activePrefetches++;
  const p = fetch(url)
    .then(async (res) => {
      if (res.ok) store(url, (await res.json()) as T);
    })
    .catch(() => {
      // Swallow — a failed prefetch just means the panel fetches on open.
    })
    .finally(() => {
      activePrefetches--;
      inFlight.delete(url);
    });
  inFlight.set(url, p);
}
