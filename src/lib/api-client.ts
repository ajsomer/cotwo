/**
 * Client-side JSON fetch helpers.
 *
 * Wraps the hand-rolled `fetch` + `res.json()` + `if (!res.ok)` + `catch`
 * blocks that client components repeat for every API call, returning a
 * discriminated result instead of throwing:
 *
 *   const result = await postJson<{ id: string }>('/api/thing', { name });
 *   if (!result.ok) { setError(result.error); return; }
 *   use(result.data);
 *
 * Error copy: on a non-ok response the server's `{ error }` message is
 * surfaced when present, else `fallbackError` (defaults to the
 * codebase-standard generic copy). Network failures always get the generic
 * copy. Pass a site-specific `fallbackError` to preserve bespoke user-facing
 * messages for server-rejected requests.
 *
 * Plain JSON only. Call sites that need the raw Response (status-code
 * branching, redirects, blobs, SSE, FormData uploads) should keep using
 * `fetch` directly.
 */

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export const GENERIC_FETCH_ERROR = 'Something went wrong. Please try again.';

async function requestJson<T>(
  url: string,
  init: RequestInit | undefined,
  fallbackError: string
): Promise<ApiResult<T>> {
  try {
    const res = await fetch(url, init);
    // Tolerate empty / non-JSON bodies (204s, proxies, error pages).
    let data: unknown = null;
    try {
      data = await res.json();
    } catch {
      data = null;
    }
    if (!res.ok) {
      const serverError =
        data && typeof data === 'object' && 'error' in data && typeof (data as { error: unknown }).error === 'string'
          ? (data as { error: string }).error
          : null;
      return { ok: false, error: serverError || fallbackError };
    }
    return { ok: true, data: data as T };
  } catch {
    return { ok: false, error: GENERIC_FETCH_ERROR };
  }
}

/** POST a JSON body and parse the JSON response. */
export function postJson<T = unknown>(
  url: string,
  body?: unknown,
  fallbackError: string = GENERIC_FETCH_ERROR
): Promise<ApiResult<T>> {
  return requestJson<T>(
    url,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
    fallbackError
  );
}

/** GET a JSON response. */
export function getJson<T = unknown>(
  url: string,
  fallbackError: string = GENERIC_FETCH_ERROR
): Promise<ApiResult<T>> {
  return requestJson<T>(url, undefined, fallbackError);
}
