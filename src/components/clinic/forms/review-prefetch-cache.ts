/**
 * Shared client-side cache for the three review panels' field-extraction
 * fetches (form-submission, intake-handoff, standalone submission). Keyed by
 * the fetch URL, holding the in-flight (or resolved) promise so that a
 * prefetch fired on hover/pointer-down is reused by the panel's loader on open.
 *
 * Mirrors `patientDetailsCache`'s 30s-TTL shape. Entries store the promise
 * (not just resolved data) so a still-in-flight prefetch is shared rather than
 * re-fetched. A rejected fetch is evicted so the panel can retry.
 */

const TTL_MS = 30_000;
const MAX_CONCURRENT_PREFETCHES = 3;

// ---------------------------------------------------------------------------
// URL builders — single source of truth so the prefetch-on-intent site and the
// panel loader produce byte-identical URLs (cache hits depend on exact match).
// ---------------------------------------------------------------------------

export function formSubmissionUrl(args: {
  appointmentId: string;
  formName: string;
  submissionId?: string | null;
}): string {
  const params = new URLSearchParams({
    appointment_id: args.appointmentId,
    form_name: args.formName,
  });
  if (args.submissionId) params.set("submission_id", args.submissionId);
  return `/api/readiness/form-submission?${params.toString()}`;
}

export function intakeHandoffUrl(appointmentId: string): string {
  return `/api/readiness/intake-handoff?appointment_id=${appointmentId}`;
}

export function standaloneSubmissionUrl(submissionId: string): string {
  return `/api/forms/standalone/submissions/${submissionId}`;
}

interface Entry {
  expiresAt: number;
  promise: Promise<Response>;
}

const cache = new Map<string, Entry>();
let inFlightPrefetches = 0;

/**
 * Fetch `url`, sharing an in-flight/cached promise when available. Used by the
 * panels' loaders on open — a prior prefetch lands instantly here.
 *
 * Returns a cloned Response each call so multiple readers can each consume the
 * body (a Response body can only be read once).
 */
export function fetchReviewData(url: string): Promise<Response> {
  const cached = cache.get(url);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.promise.then((res) => res.clone());
  }
  const promise = fetch(url);
  cache.set(url, { promise, expiresAt: Date.now() + TTL_MS });
  evictIfNotOk(url, promise);
  // Caller still gets the (cloned) response even on a non-ok status and handles
  // it; we just don't retain it in the cache (eviction above).
  return promise.then((res) => res.clone());
}

// Drop the cache entry if the fetch rejects (network error) OR resolves to a
// non-ok HTTP status (404/401/500). Otherwise a transient bad response would
// poison the panel open for the whole TTL. Only the entry still pointing at
// THIS promise is removed, so a fresher fetch isn't clobbered.
function evictIfNotOk(url: string, promise: Promise<Response>): void {
  promise
    .then((res) => {
      if (!res.ok && cache.get(url)?.promise === promise) cache.delete(url);
    })
    .catch(() => {
      if (cache.get(url)?.promise === promise) cache.delete(url);
    });
}

/**
 * Warm the cache for `url` on intent (hover / pointer-down). No-op if already
 * cached/in-flight, or if the concurrent-prefetch cap is hit (we don't want a
 * hover sweep to fan out dozens of requests). Errors are swallowed — a failed
 * prefetch just means the panel fetches normally on open.
 */
export function prefetchReviewData(url: string): void {
  const cached = cache.get(url);
  if (cached && cached.expiresAt > Date.now()) return;
  if (inFlightPrefetches >= MAX_CONCURRENT_PREFETCHES) return;

  inFlightPrefetches++;
  const promise = fetch(url);
  cache.set(url, { promise, expiresAt: Date.now() + TTL_MS });
  evictIfNotOk(url, promise);
  promise.finally(() => {
    inFlightPrefetches--;
  });
}
