import "server-only";
import type { ClinikoListEnvelope } from "./types";

/**
 * Cliniko REST client. Plan §3, §10.
 *
 * - Auth: HTTP Basic, base64(api_key + ":"). NOT OAuth.
 * - Shard ('au1', 'au2', 'uk1', …) is encoded in the key suffix after the last
 *   '-'; the base URL is derived from it: https://api.{shard}.cliniko.com/v1/.
 * - Rate limit: 200 req/min → 429. We honour Retry-After with bounded backoff.
 * - Pagination: 50/page default (100 max); follow `links.next`.
 *
 * Key-gated: if constructed with an empty key the client throws on use. Callers
 * gate on a sync-active connection (credentials present) before building one.
 */

const USER_AGENT = "Coviu/1.0 (cliniko-integration; prototype)";
const MAX_RETRIES = 4;

export class ClinikoApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body?: unknown
  ) {
    super(message);
    this.name = "ClinikoApiError";
  }
}

/** Derive the shard from a Cliniko API key (suffix after the last '-'). */
export function shardFromKey(apiKey: string): string {
  const idx = apiKey.lastIndexOf("-");
  const shard = idx >= 0 ? apiKey.slice(idx + 1).trim() : "";
  // Cliniko shards look like 'au1'/'au2'/'uk1'. Guard against junk.
  if (!/^[a-z]{2}\d+$/i.test(shard)) {
    throw new ClinikoApiError(
      "Could not derive Cliniko shard from API key. Keys end in a shard suffix like '-au1'.",
      0
    );
  }
  return shard.toLowerCase();
}

export function baseUrlForKey(apiKey: string): string {
  return `https://api.${shardFromKey(apiKey)}.cliniko.com/v1`;
}

/** Public web-app host for a shard (used for deep links; verify at build §6.2). */
export function webHostForShard(shard: string): string {
  return `https://${shard}.cliniko.com`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export class ClinikoClient {
  private readonly authHeader: string;
  private readonly baseUrl: string;
  readonly shard: string;

  constructor(apiKey: string) {
    if (!apiKey || !apiKey.trim()) {
      throw new ClinikoApiError("Cliniko API key is required", 0);
    }
    this.shard = shardFromKey(apiKey);
    this.baseUrl = `https://api.${this.shard}.cliniko.com/v1`;
    this.authHeader =
      "Basic " + Buffer.from(`${apiKey}:`).toString("base64");
  }

  /** Low-level fetch with 429/5xx backoff. `url` may be absolute or a path. */
  async request<T>(
    url: string,
    init?: { method?: string; body?: unknown }
  ): Promise<T> {
    const fullUrl = url.startsWith("http") ? url : `${this.baseUrl}${url}`;
    const method = init?.method ?? "GET";

    for (let attempt = 0; ; attempt++) {
      let res: Response;
      try {
        res = await fetch(fullUrl, {
          method,
          headers: {
            Authorization: this.authHeader,
            Accept: "application/json",
            "Content-Type": "application/json",
            "User-Agent": USER_AGENT,
          },
          body: init?.body ? JSON.stringify(init.body) : undefined,
        });
      } catch (e) {
        // Network/transport error — retry a couple of times, then surface.
        if (attempt < MAX_RETRIES) {
          await sleep(500 * 2 ** attempt);
          continue;
        }
        throw new ClinikoApiError(
          `Network error contacting Cliniko: ${(e as Error).message}`,
          0
        );
      }

      if (res.status === 429 || res.status >= 500) {
        if (attempt < MAX_RETRIES) {
          const retryAfter = Number(res.headers.get("retry-after"));
          const waitMs = Number.isFinite(retryAfter) && retryAfter > 0
            ? retryAfter * 1000
            : Math.min(500 * 2 ** attempt, 8000);
          await sleep(waitMs);
          continue;
        }
      }

      const text = await res.text();
      const parsed = text ? safeJson(text) : undefined;

      if (!res.ok) {
        throw new ClinikoApiError(
          `Cliniko ${method} ${fullUrl} → ${res.status}`,
          res.status,
          parsed ?? text
        );
      }
      return parsed as T;
    }
  }

  /**
   * Iterate every entry of a list resource, following pagination.
   * `resourceKey` is the array key in the envelope (e.g. 'patients').
   * `query` is appended to the first page; later pages use `links.next`.
   */
  async *list<T>(
    resource: string,
    resourceKey: string,
    query?: Record<string, string | string[] | number>
  ): AsyncIterable<T> {
    let url: string | undefined = `/${resource}?${buildQuery({
      per_page: 100,
      ...query,
    })}`;

    while (url) {
      const env: ClinikoListEnvelope<T> = await this.request(url);
      const rows = (env[resourceKey] as T[]) ?? [];
      for (const row of rows) yield row;
      url = env.links?.next;
    }
  }

  /** Fetch a single resource by absolute self-link or path. */
  async get<T>(url: string): Promise<T> {
    return this.request<T>(url);
  }

  async patch<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>(path, { method: "PATCH", body });
  }

  async post<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>(path, { method: "POST", body });
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** Build a Cliniko query string supporting repeated `q[]` params. */
export function buildQuery(
  params: Record<string, string | string[] | number>
): string {
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (Array.isArray(v)) {
      for (const item of v) usp.append(k, item);
    } else {
      usp.append(k, String(v));
    }
  }
  return usp.toString();
}

/** Extract the trailing numeric id from a Cliniko self-link. */
export function idFromSelfLink(link?: { links?: { self?: string } }): string | null {
  const self = link?.links?.self;
  if (!self) return null;
  const m = self.match(/\/(\d+)(?:\?.*)?$/);
  return m ? m[1] : null;
}
