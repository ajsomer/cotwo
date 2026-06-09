import "server-only";
import type { NookalEnvelope } from "./types";

/**
 * Nookal REST client. Plan docs/plans/nookal-integration.md §2 (transport box).
 *
 * Transport VERIFIED (2026-06-09) against the working Elixir client
 * theo-agilelab/nookal-api (lib/nookal/client.ex) + the Nookal docs:
 *
 * - Base URL: https://api.nookal.com/production/v2/<function>. SINGLE host, NO
 *   shard (unlike Cliniko, which encodes a shard in the key).
 * - Method: every call is POST.
 * - Auth: `api_key` is a FORM-BODY field (not a header, not a query param).
 *   Content-Type application/x-www-form-urlencoded; charset=UTF-8.
 * - Envelope: { status: "success"|"failure", data: { results: { <key>: [...] } },
 *   details: {...}, settings: { currentPage, nextPage, pageLength } }.
 *   Failure → details.errorMessage (also errorCode/errorDescription per the
 *   object spec). Results live at payload.data.results.<resourceKey>.
 * - Pagination: `page` / `page_length` form fields (page_length cap 200);
 *   settings.nextPage is null on the last page → loop terminator.
 *
 * Rate limits aren't published; we honour Retry-After and back off on 429/5xx.
 *
 * Key-gated: constructed with an empty key throws on use. Callers gate on a
 * sync-active connection (credentials present) before building one.
 */

const BASE_URL = "https://api.nookal.com/production/v2";
const USER_AGENT = "Coviu/1.0 (nookal-integration; prototype)";
const MAX_RETRIES = 4;
/** Nookal caps page_length at 200 (docs). */
const PAGE_LENGTH = 200;

export class NookalApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body?: unknown,
    /** Nookal's own errorCode when the envelope reports a failure. */
    readonly apiErrorCode?: string
  ) {
    super(message);
    this.name = "NookalApiError";
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export class NookalClient {
  private readonly apiKey: string;

  constructor(apiKey: string) {
    if (!apiKey || !apiKey.trim()) {
      throw new NookalApiError("Nookal API key is required", 0);
    }
    this.apiKey = apiKey.trim();
  }

  /**
   * POST a Nookal function with form-encoded params (api_key injected), with
   * 429/5xx backoff. Returns the parsed envelope. Throws NookalApiError on a
   * transport error or an envelope `status: "failure"`.
   */
  async request<T = unknown>(
    fn: string,
    params: Record<string, string | number | undefined> = {}
  ): Promise<NookalEnvelope<T>> {
    const url = `${BASE_URL}/${fn}`;
    const form = new URLSearchParams();
    form.set("api_key", this.apiKey);
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== "") form.set(k, String(v));
    }
    const body = form.toString();

    for (let attempt = 0; ; attempt++) {
      let res: Response;
      try {
        res = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
            Accept: "application/json",
            "User-Agent": USER_AGENT,
          },
          body,
        });
      } catch (e) {
        if (attempt < MAX_RETRIES) {
          await sleep(500 * 2 ** attempt);
          continue;
        }
        throw new NookalApiError(
          `Network error contacting Nookal: ${(e as Error).message}`,
          0
        );
      }

      if (res.status === 429 || res.status >= 500) {
        if (attempt < MAX_RETRIES) {
          const retryAfter = Number(res.headers.get("retry-after"));
          const waitMs =
            Number.isFinite(retryAfter) && retryAfter > 0
              ? retryAfter * 1000
              : Math.min(500 * 2 ** attempt, 8000);
          await sleep(waitMs);
          continue;
        }
      }

      const text = await res.text();
      const parsed = text ? safeJson(text) : undefined;

      if (!res.ok) {
        throw new NookalApiError(
          `Nookal POST ${fn} → ${res.status}`,
          res.status,
          parsed ?? text
        );
      }

      // Nookal returns HTTP 200 even for logical failures — the envelope's
      // `status` field is the real success indicator.
      const env = parsed as NookalEnvelope<T> | undefined;
      if (!env || typeof env !== "object") {
        throw new NookalApiError(`Nookal ${fn}: unparseable response`, res.status, text);
      }
      if (env.status === "failure") {
        const detail =
          env.details?.errorMessage ??
          env.details?.errorDescription ??
          env.error ??
          "Nookal request failed.";
        throw new NookalApiError(
          `Nookal ${fn}: ${detail}`,
          // Treat an auth failure like a 401 so callers can map it cleanly.
          isAuthError(env.details?.errorCode, detail) ? 401 : res.status,
          env,
          env.details?.errorCode
        );
      }
      return env;
    }
  }

  /**
   * Iterate every entry of a paginated list function, following `nextPage`.
   * `resourceKey` is the key under `data.results` holding the array
   * (e.g. 'appointments'). Extra `params` are passed on every page.
   */
  async *list<T>(
    fn: string,
    resourceKey: string,
    params: Record<string, string | number | undefined> = {}
  ): AsyncIterable<T> {
    let page = 1;
    while (true) {
      const env = await this.request<T>(fn, {
        ...params,
        page,
        page_length: PAGE_LENGTH,
      });
      const rows = (env.data?.results?.[resourceKey] as T[] | undefined) ?? [];
      for (const row of rows) yield row;
      // Pagination lives in `settings`: nextPage is null on the last page.
      const next = env.settings?.nextPage ?? null;
      if (next === null || next === undefined || rows.length === 0) break;
      page = typeof next === "number" ? next : Number(next);
      if (!Number.isFinite(page)) break;
    }
  }

  /** Fetch the single resource array for a function (one page, no iteration). */
  async listOnce<T>(
    fn: string,
    resourceKey: string,
    params: Record<string, string | number | undefined> = {}
  ): Promise<T[]> {
    const out: T[] = [];
    for await (const row of this.list<T>(fn, resourceKey, params)) out.push(row);
    return out;
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** Heuristic: does this envelope failure look like a bad/disabled API key? */
function isAuthError(code: string | undefined, message: string): boolean {
  if (code && /key|auth/i.test(code)) return true;
  return /api key|invalid key|unauthor|not authorised|not authorized/i.test(
    message
  );
}
