import "server-only";

/**
 * Gentu (Magentus) REST client. Plan docs/plans/gentu-integration.md §3 (the
 * OAuth client + pairing connect flow) + docs/architecture/
 * gentu-bookings-healthcare-api.md.
 *
 * Transport AUTH VERIFIED (2026-06-15) against api.pm.sandbox.magentus.com:
 *
 * - Token: POST /v1/oauth2/token — NOTE the /v1 prefix; the OpenAPI specs'
 *   bare /oauth2/token is wrong. HTTP Basic (client id:secret) + form body
 *   `grant_type=client_credentials`. Response: { access_token, expires_in:3599,
 *   refresh_token_expires_in:0, token_type:"Bearer", application_name:<appId>,
 *   status:"approved" }. NO refresh token → re-mint from client-credentials on
 *   expiry. We cache the token in-process and re-mint on a miss (no persist-back
 *   hook needed; the connection blob stays write-once — plan §10).
 * - Two APIs share host + token: Bookings (writes) and Healthcare (reads +
 *   attachment). Both are /v1/tenants/{tenantId}/… scoped. We route per call
 *   via the `api` arg; the split never leaks to generic code (plan §4).
 *
 * ⚠️ BLOCKED (Magentus side, 2026-06-15): every authed tenant call returns
 *   HTTP 500 {"faultstring":"Unresolved variable : app.partnerId"}. The token
 *   is accepted (no-auth → 401), so auth works — the sandbox app isn't
 *   provisioned with partnerId/tenant pairing. This client is written and
 *   type-checked but the tenant calls are unrunnable until Magentus fixes it
 *   (plan §0a). When unblocked, GET /v1/tenants should list paired tenants.
 *
 * App credentials are APP-WIDE (env), never per-clinic:
 *   GENTU_API_KEY (OAuth client id), GENTU_API_KEY_SECRET, GENTU_APP_ID.
 * The per-clinic secret is the tenantId, captured at connect via the pairing
 * code and stored in the connection blob.
 *
 * Credential-gated: constructed without a tenantId, read calls throw (the
 * client stays dormant until a connection is sync-active). The pairing-consume
 * call is the one exception — it runs pre-tenant to OBTAIN the tenantId.
 */

const BASE_URL = "https://api.pm.sandbox.magentus.com";
const TOKEN_PATH = "/v1/oauth2/token";
const USER_AGENT = "Coviu/1.0 (gentu-integration; prototype)";
const MAX_RETRIES = 4;
/** Re-mint this many seconds BEFORE the token's stated expiry (clock-skew + in-flight safety). */
const TOKEN_EXPIRY_MARGIN_SECONDS = 60;

/** Which Magentus API a call targets. Both share host, token, and tenant scope. */
export type GentuApi = "bookings" | "healthcare";

export class GentuApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body?: unknown,
    /** Magentus Apigee fault code when present (e.g. "entities.UnresolvedVariable"). */
    readonly apiErrorCode?: string
  ) {
    super(message);
    this.name = "GentuApiError";
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** App-wide OAuth client credentials, read from env (never per-clinic). */
export interface GentuAppCredentials {
  clientId: string;
  clientSecret: string;
  appId: string;
}

/**
 * Read the app credentials from env. Returns null if any are missing so the
 * client (and the whole adapter) stays dormant rather than throwing at import
 * time — mirrors the key-gating the other adapters do on their per-clinic key.
 */
export function gentuAppCredentialsFromEnv(): GentuAppCredentials | null {
  const clientId = process.env.GENTU_API_KEY?.trim();
  const clientSecret = process.env.GENTU_API_KEY_SECRET?.trim();
  const appId = process.env.GENTU_APP_ID?.trim();
  if (!clientId || !clientSecret || !appId) return null;
  return { clientId, clientSecret, appId };
}

interface CachedToken {
  accessToken: string;
  /** Epoch ms after which we should re-mint (already includes the safety margin). */
  refreshAfter: number;
}

/**
 * Process-wide token cache, keyed by client id. Client-credentials tokens are
 * app-scoped, not tenant-scoped, so one token serves every tenant the app is
 * paired with — a single cache entry per app credential. Re-minted on a miss
 * (cold start, expiry). ⚠️ If §2 item 1 reveals Bookings and Healthcare need
 * SEPARATELY-SCOPED tokens, key this by `${clientId}:${api}` and mint per-api.
 */
const tokenCache = new Map<string, CachedToken>();

interface GentuTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token_expires_in: number;
  application_name?: string;
  status?: string;
  api_product_list?: string;
}

export class GentuClient {
  private readonly app: GentuAppCredentials;
  /** Per-connection tenant id (null only for the pre-pairing consume call). */
  private readonly tenantId: string | null;

  constructor(app: GentuAppCredentials, tenantId: string | null) {
    this.app = app;
    this.tenantId = tenantId;
  }

  /** Mint (or reuse a cached) app bearer token. */
  private async getToken(): Promise<string> {
    const cached = tokenCache.get(this.app.clientId);
    if (cached && Date.now() < cached.refreshAfter) {
      return cached.accessToken;
    }
    const token = await this.mintToken();
    tokenCache.set(this.app.clientId, {
      accessToken: token.access_token,
      refreshAfter:
        Date.now() +
        Math.max(0, token.expires_in - TOKEN_EXPIRY_MARGIN_SECONDS) * 1000,
    });
    return token.access_token;
  }

  /** POST /v1/oauth2/token with HTTP Basic + client_credentials grant. */
  private async mintToken(): Promise<GentuTokenResponse> {
    const basic = Buffer.from(
      `${this.app.clientId}:${this.app.clientSecret}`
    ).toString("base64");
    let res: Response;
    try {
      res = await fetch(`${BASE_URL}${TOKEN_PATH}`, {
        method: "POST",
        headers: {
          Authorization: `Basic ${basic}`,
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
          "User-Agent": USER_AGENT,
        },
        body: "grant_type=client_credentials",
      });
    } catch (e) {
      throw new GentuApiError(
        `Network error minting Gentu token: ${(e as Error).message}`,
        0
      );
    }
    const text = await res.text();
    const parsed = text ? safeJson(text) : undefined;
    if (!res.ok) {
      throw new GentuApiError(
        `Gentu token mint → ${res.status} (check GENTU_API_KEY / GENTU_API_KEY_SECRET)`,
        res.status,
        parsed ?? text
      );
    }
    const token = parsed as GentuTokenResponse | undefined;
    if (!token?.access_token) {
      throw new GentuApiError("Gentu token response had no access_token", res.status, parsed);
    }
    return token;
  }

  private requireTenant(): string {
    if (!this.tenantId) {
      throw new GentuApiError(
        "Gentu client has no tenantId — connection isn't paired yet.",
        0
      );
    }
    return this.tenantId;
  }

  /**
   * Authenticated request against a tenant-scoped path on one of the two APIs.
   * `path` is appended after `/v1/tenants/{tenantId}`. Handles token mint,
   * 401 re-mint-once, and 429/5xx backoff. Returns parsed JSON.
   */
  async request<T = unknown>(
    api: GentuApi,
    method: "GET" | "POST" | "PATCH" | "PUT",
    path: string,
    opts: {
      query?: Record<string, string | number | undefined>;
      body?: unknown;
      /** Raw body + content-type for binary uploads (attachments). */
      rawBody?: { contentType: string; data: Buffer };
    } = {}
  ): Promise<T> {
    const tenantId = this.requireTenant();
    const url = new URL(`${BASE_URL}/v1/tenants/${tenantId}${path}`);
    for (const [k, v] of Object.entries(opts.query ?? {})) {
      // ISO datetimes carry '+' offsets that get stripped unless URI-encoded;
      // URLSearchParams encodes them correctly.
      if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
    }

    let mintedFresh = false;
    for (let attempt = 0; ; attempt++) {
      const token = await this.getToken();
      let res: Response;
      try {
        res = await fetch(url.toString(), {
          method,
          headers: this.headers(token, opts),
          body: this.encodeBody(opts),
        });
      } catch (e) {
        if (attempt < MAX_RETRIES) {
          await sleep(500 * 2 ** attempt);
          continue;
        }
        throw new GentuApiError(
          `Network error contacting Gentu: ${(e as Error).message}`,
          0
        );
      }

      // A 401 mid-session means the cached token lapsed early — re-mint once.
      if (res.status === 401 && !mintedFresh) {
        tokenCache.delete(this.app.clientId);
        mintedFresh = true;
        continue;
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
        // Magentus surfaces Apigee policy failures as { fault: { faultstring,
        // detail: { errorcode } } } — pull the specific message out so callers
        // never see a bare status (e.g. the app.partnerId provisioning fault).
        const fault = extractFault(parsed);
        throw new GentuApiError(
          `Gentu ${method} ${api}${path} → ${res.status}${fault ? `: ${fault.message}` : ""}`,
          res.status,
          parsed ?? text,
          fault?.code
        );
      }

      return parsed as T;
    }
  }

  private headers(
    token: string,
    opts: { rawBody?: { contentType: string }; body?: unknown }
  ): Record<string, string> {
    const h: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "User-Agent": USER_AGENT,
    };
    if (opts.rawBody) h["Content-Type"] = opts.rawBody.contentType;
    else if (opts.body !== undefined) h["Content-Type"] = "application/json";
    return h;
  }

  private encodeBody(opts: {
    body?: unknown;
    rawBody?: { data: Buffer };
  }): BodyInit | undefined {
    if (opts.rawBody) return new Uint8Array(opts.rawBody.data);
    if (opts.body !== undefined) return JSON.stringify(opts.body);
    return undefined;
  }

  /**
   * Consume a pairing code to authorise this app against the tenant that
   * generated it. Runs PRE-tenant (this is how we obtain the tenantId), so it
   * hits the app-scoped /v1/apps/{appId}/pairing/{code} path directly rather
   * than going through `request()`. Returns the tenantId on success.
   *
   * ⚠️ Unrunnable until Magentus clears the app provisioning block (plan §0a).
   */
  async consumePairingCode(
    code: string
  ): Promise<{ ok: boolean; tenantId?: string; detail?: string }> {
    const token = await this.getToken();
    const url = `${BASE_URL}/v1/apps/${encodeURIComponent(
      this.app.appId
    )}/pairing/${encodeURIComponent(code)}`;
    let res: Response;
    try {
      res = await fetch(url, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
          "User-Agent": USER_AGENT,
        },
      });
    } catch (e) {
      return { ok: false, detail: `Network error pairing with Gentu: ${(e as Error).message}` };
    }
    const text = await res.text();
    const parsed = text ? safeJson(text) : undefined;
    if (!res.ok) {
      const fault = extractFault(parsed);
      return {
        ok: false,
        detail: fault?.message ?? `Gentu rejected the pairing code (HTTP ${res.status}).`,
      };
    }
    const tenantId = (parsed as { tenantId?: string } | undefined)?.tenantId;
    if (!tenantId) {
      return { ok: false, detail: "Gentu pairing succeeded but returned no tenantId." };
    }
    return { ok: true, tenantId };
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** Pull the actionable message + code out of a Magentus Apigee fault payload. */
function extractFault(
  parsed: unknown
): { message: string; code?: string } | null {
  if (!parsed || typeof parsed !== "object") return null;
  const fault = (parsed as { fault?: { faultstring?: string; detail?: { errorcode?: string } } })
    .fault;
  if (!fault) return null;
  return {
    message: fault.faultstring ?? "Gentu request failed.",
    code: fault.detail?.errorcode,
  };
}
