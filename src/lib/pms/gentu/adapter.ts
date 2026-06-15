import "server-only";
import type {
  PmsAdapter,
  PmsAdapterFactory,
  PmsCapabilities,
  PmsCredentialField,
  PmsCredentials,
  PmsFieldCatalogueEntry,
  PmsFieldValidation,
} from "../adapter";
import type {
  PmsAppointment,
  PmsAppointmentType,
  PmsBusiness,
  PmsFailureKind,
  PmsFieldResult,
  PmsFormFieldInput,
  PmsFormSubmissionInput,
  PmsPatient,
  PmsPractitioner,
  PmsPushResult,
} from "../types";
import {
  fillBlanksWrite,
  orchestratePush,
  validateCatalogueValue,
} from "../push-helpers";
import {
  GentuApiError,
  GentuClient,
  gentuAppCredentialsFromEnv,
  type GentuAppCredentials,
} from "./client";
import {
  mapAppointment,
  mapAppointmentType,
  mapPatient,
  mapPractitioner,
  // mapSite — used once the location concept is confirmed and listBusinesses
  // pulls practitioner sites (§2 item 4 / plan §1a deferred).
} from "./map";
import {
  GENTU_FIELD_CATALOGUE,
  applyToPatch,
  catalogueEntry,
  readCurrentValue,
} from "./field-map";
import type {
  GentuAppointment,
  GentuAppointmentListResponse,
  GentuAppointmentType,
  GentuAttachmentStatus,
  GentuAttachmentUploadResponse,
  GentuPatient,
  GentuPatientPatch,
  GentuUser,
} from "./types";

/**
 * Gentu (Magentus) adapter. Plan docs/plans/gentu-integration.md.
 *
 * Two APIs behind one adapter (plan §4): reads off Healthcare, the patient
 * PATCH off Bookings, the attachment off Healthcare. The split never leaves
 * this file.
 *
 * Capabilities reflect what Gentu ACTUALLY supports:
 * - writePatientFields: true  (Bookings PATCH /patients — §6a)
 * - writeForms:         FALSE (no structured form/note sink in either API — §6c)
 * - writeAttachments:   true  (Healthcare PUT .../attachments, categorised — §6b)
 * - webLinks:           FALSE (no documented patient deep-link URL)
 * - webhooks:           false (polling)
 *
 * ⚠️ Live calls are BLOCKED on Magentus app provisioning (app.partnerId; §0a).
 * Auth is verified; everything below is type-checked but unrunnable end-to-end
 * until the sandbox app is paired. Unverified behaviours are pinned with
 * "⚠️ verify" + actionable-error fallbacks (the Nookal pattern).
 */
const CAPABILITIES: PmsCapabilities = {
  webhooks: false,
  writeForms: false,
  writePatientFields: true,
  writeNotes: false,
  writeAttachments: true,
  webLinks: false,
};

const CREDENTIAL_FIELDS: PmsCredentialField[] = [
  {
    key: "pairing_code",
    label: "Gentu pairing code",
    inputType: "text",
    placeholder: "8-character code from Gentu",
    helpText:
      "In Gentu, generate a pairing code for the Coviu app, then paste it here. We exchange it for your practice (tenant) connection — you won't need it again.",
  },
];

/** How many days forward the windowed appointment re-sweep pulls (plan §5). */
const SWEEP_WINDOW_DAYS = 30;
/** Attachment upload polling (async + virus scan; §6b). */
const ATTACH_POLL_ATTEMPTS = 10;
const ATTACH_POLL_INTERVAL_MS = 1500;

class GentuAdapter implements PmsAdapter {
  readonly provider = "gentu";
  readonly displayName = "Gentu";
  private readonly client: GentuClient;

  constructor(
    private readonly connectionId: string,
    app: GentuAppCredentials,
    private readonly tenantId: string
  ) {
    this.client = new GentuClient(app, tenantId);
  }

  // ── CONNECTION ──
  async verify(): Promise<{ ok: boolean; detail?: string }> {
    try {
      await this.client.request("healthcare", "GET", "/status");
      return { ok: true };
    } catch (e) {
      const err = e as GentuApiError;
      if (err.status === 401 || err.status === 403) {
        return { ok: false, detail: "Gentu rejected the app credentials — reconnect." };
      }
      // The app.partnerId provisioning fault surfaces here until Magentus fixes
      // it (§0a); pass the specific message through, not a bare status.
      return { ok: false, detail: err.message };
    }
  }

  // ── READ ──
  /**
   * WINDOWED RE-SWEEP, not incremental (plan §5). The Gentu appointment schema
   * has NO updatedAt and the list has NO changed-since filter — only
   * fromDate/toDate + an opaque pagination.next. So we IGNORE opts.since
   * entirely and always sweep [now, now+SWEEP_WINDOW_DAYS], paging next to
   * exhaustion. Idempotent upserts absorb re-seen rows; map.ts returns
   * updatedAt:null so the generic cursor never advances. `practitionerId` is a
   * REQUIRED query param, so we sweep per mapped practitioner.
   *
   * ⚠️ Verify the max window width + rate ceiling on a live tenant (§2 item 3).
   * include= side-load is NOT used in v1 — patients are lazy-fetched via
   * getPatient during upsert (plan §1a.4).
   */
  async *listAppointments(opts: {
    since?: Date;
    businessId?: string;
  }): AsyncIterable<PmsAppointment> {
    // opts.since intentionally ignored (windowed re-sweep — see above).
    void opts.since;
    const practitioners = await this.listPractitioners();
    const fromDate = isoNow();
    const toDate = isoDaysFromNow(SWEEP_WINDOW_DAYS);

    for (const prac of practitioners) {
      let cursor: string | null = null;
      do {
        const resp: GentuAppointmentListResponse = await this.client.request<GentuAppointmentListResponse>(
          "healthcare",
          "GET",
          "/appointments",
          {
            query: {
              fromDate,
              toDate,
              practitionerId: prac.externalId,
              limit: 100,
              cursor: cursor ?? undefined,
            },
          }
        );
        for (const a of resp.appointments ?? []) yield mapAppointment(a);
        cursor = resp.pagination?.next ?? null;
      } while (cursor);
    }
  }

  /**
   * Yields NOTHING for Gentu (plan §1a.4). Healthcare has no list-since for
   * patients; the generic pull lazy-fetches each appointment's patient via
   * getPatient during upsert instead. This is intentional — not a stub bug.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async *listPatients(opts: { since?: Date }): AsyncIterable<PmsPatient> {
    return;
  }

  async getPatient(externalId: string): Promise<PmsPatient | null> {
    const raw = await this.fetchRawPatient(externalId);
    return raw ? mapPatient(raw) : null;
  }

  private async fetchRawPatient(externalId: string): Promise<GentuPatient | null> {
    try {
      return await this.client.request<GentuPatient>(
        "healthcare",
        "GET",
        `/patients/${encodeURIComponent(externalId)}`
      );
    } catch (e) {
      if ((e as GentuApiError).status === 404) return null;
      throw e;
    }
  }

  async getAppointment(externalId: string): Promise<PmsAppointment | null> {
    try {
      const a = await this.client.request<GentuAppointment>(
        "healthcare",
        "GET",
        `/appointments/${encodeURIComponent(externalId)}`
      );
      return a ? mapAppointment(a) : null;
    } catch (e) {
      if ((e as GentuApiError).status === 404) return null;
      throw e;
    }
  }

  async listPractitioners(): Promise<PmsPractitioner[]> {
    const rows = await this.client.request<GentuUser[]>(
      "healthcare",
      "GET",
      "/practitioners"
    );
    return (rows ?? []).map(mapPractitioner);
  }

  async listAppointmentTypes(): Promise<PmsAppointmentType[]> {
    const rows = await this.client.request<GentuAppointmentType[]>(
      "healthcare",
      "GET",
      "/appointment-types"
    );
    return (rows ?? []).map(mapAppointmentType);
  }

  /**
   * The location concept (plan §2 item 4). Sites-of-service is the current best
   * candidate for PmsBusiness. ⚠️ Verify against a live tenant whether a Coviu
   * location maps to tenant, site, or practitioner-site before trusting this.
   * `listBusinesses` is called without a practitioner here; the sites endpoint
   * is practitioner-scoped, so v1 returns [] (single-tenant accounts don't need
   * the business filter — the pull falls back to unfiltered, which is correct).
   */
  async listBusinesses(): Promise<PmsBusiness[]> {
    // ⚠️ Sites are practitioner-scoped (GET .../practitioners/{id}/sites); there
    // is no tenant-wide site list. Returning [] keeps single-business accounts
    // working (pull goes unfiltered). Revisit for multi-site tenants once the
    // location concept is confirmed (§2 item 4).
    return [];
  }

  // ── WRITE ──
  async pushFormSubmission(
    input: PmsFormSubmissionInput
  ): Promise<PmsPushResult> {
    // writeForms is false → no writeFormAnswers hook; everything is a
    // patient_field write (Bookings PATCH) or unmapped.
    return orchestratePush(input, {
      providerLabel: this.displayName,
      catalogueEntry,
      writePatientFields: (externalId, fields) =>
        this.writePatientFields(externalId, fields),
    });
  }

  /**
   * Fill-blanks-only patient write via Bookings PATCH /patients/{id} (§6a).
   * Gentu PATCH is a merge and the spec recommends GET-first, so readCurrent
   * fetches the patient and only currently-empty fields are written.
   *
   * Gentu's write shape isn't a flat param map — names go to extension, contact
   * to a tuple, address to an array element. So we use the CATALOGUE KEY as the
   * fillBlanks "write param" (it's unique + stable) and build the actual
   * GentuPatientPatch from those keys in writeBatch/writeOne via applyToPatch.
   *
   * ⚠️ DATA-LOSS GUARD (§2 item 7): this assumes Gentu PATCH leaves OMITTED
   * fields untouched (true merge). If a live tenant shows omitting a field nulls
   * it, fill-blanks is unsafe and this must change — verify before first write.
   */
  private writePatientFields(
    externalId: string,
    fields: PmsFormFieldInput[]
  ): Promise<PmsFieldResult[]> {
    let cachedRaw: GentuPatient | null | undefined;
    const readOnce = async (): Promise<GentuPatient | null> => {
      if (cachedRaw === undefined) cachedRaw = await this.fetchRawPatient(externalId);
      return cachedRaw;
    };

    return fillBlanksWrite(fields, {
      providerLabel: this.displayName,
      // null → every field fails (never treat an unreadable record as all-blank).
      readCurrent: async () => {
        const raw = await readOnce();
        if (!raw) return null;
        // Project the raw patient into a key→current-value map keyed by our
        // catalogue keys, so fillBlanksWrite's blank-check (which reads by the
        // same "write param" string we return below) lines up.
        const flat: Record<string, unknown> = {};
        for (const e of GENTU_FIELD_CATALOGUE) {
          flat[e.key] = readCurrentValue(e.key, raw);
        }
        return flat;
      },
      // We use the catalogue key itself as the param identifier (Gentu has no
      // flat param name); readFieldFor uses the same key so the blank-check
      // reads the projected map above.
      writeParamFor: (key) => (catalogueEntry(key) ? key : undefined),
      readFieldFor: (key) => key,
      validate: (key, value) => this.validateField(key, value),
      writeBatch: async (patch) => {
        // `patch` is { catalogueKey: value }; build the Gentu patch from it.
        const body = this.buildPatch(patch);
        await this.patchPatient(externalId, body);
      },
      writeOne: async (key, value) => {
        const body = this.buildPatch({ [key]: value });
        await this.patchPatient(externalId, body);
      },
      mapError: (e) => transportDetail(e as GentuApiError),
    });
  }

  /** Build a GentuPatientPatch from a {catalogueKey: value} map. */
  private buildPatch(byKey: Record<string, string>): GentuPatientPatch {
    const patch: GentuPatientPatch = {};
    for (const [key, value] of Object.entries(byKey)) {
      applyToPatch(key, value, patch);
    }
    return patch;
  }

  private async patchPatient(
    externalId: string,
    body: GentuPatientPatch
  ): Promise<void> {
    await this.client.request("bookings", "PATCH", `/patients/${encodeURIComponent(externalId)}`, {
      body,
    });
  }

  /**
   * Attach the intake PDF via Healthcare PUT .../attachments (§6b). Categorised
   * (`attachment`), async + virus-scanned: PUT returns an attachmentId, then we
   * poll GET .../attachments/{id} until `completed`. `practitionerId` is REQUIRED
   * and comes from `practitionerExternalId` (the §1a.3 interface field).
   *
   * ⚠️ Body is raw binary PDF; the spec's content-type enum also lists
   * multipart/form-data (§2 item 6) — verify which the tenant accepts.
   */
  async uploadPatientAttachment(input: {
    externalId: string;
    fileName: string;
    contentType: string;
    contentBase64: string;
    description?: string;
    practitionerExternalId?: string;
  }): Promise<{ ok: boolean; attachmentId?: string; detail?: string }> {
    if (!input.practitionerExternalId) {
      return {
        ok: false,
        detail: "Gentu needs a practitioner to file the attachment against.",
      };
    }
    const bytes = Buffer.from(input.contentBase64, "base64");
    if (bytes.byteLength > 4 * 1024 * 1024) {
      return { ok: false, detail: "Attachment exceeds Gentu's 4 MB limit." };
    }
    try {
      const resp = await this.client.request<GentuAttachmentUploadResponse>(
        "healthcare",
        "PUT",
        `/patients/${encodeURIComponent(input.externalId)}/attachments`,
        {
          query: {
            category: "attachment",
            fileName: input.fileName,
            practitionerId: input.practitionerExternalId,
          },
          rawBody: { contentType: input.contentType, data: bytes },
        }
      );
      const attachmentId = resp?.attachmentId;
      if (!attachmentId) {
        return { ok: false, detail: "Gentu didn't return an attachment id." };
      }
      const final = await this.pollAttachment(input.externalId, attachmentId);
      if (final === "completed") return { ok: true, attachmentId };
      if (final === "scanned_infected") {
        return { ok: false, attachmentId, detail: "Gentu flagged the file as infected." };
      }
      if (final === "failed") {
        return { ok: false, attachmentId, detail: "Gentu failed to store the file." };
      }
      // Non-terminal after the poll budget (still accepted/scanned_clean). We
      // CANNOT confirm it landed — Gentu may still reject it in scanning — so we
      // do NOT report success (a false "done" is worse than a retryable
      // "pending"). The contract is boolean ok, so this is ok:false with an
      // actionable detail; the attachmentId is returned so a retry/check can
      // reference it. ⚠️ If the UI grows a "pending" state, surface it here.
      return {
        ok: false,
        attachmentId,
        detail:
          "Uploaded to Gentu but still processing — confirm it appears on the patient file, or retry.",
      };
    } catch (e) {
      const err = e as GentuApiError;
      console.error("[gentu attach] error:", err.status, JSON.stringify(err.body));
      return { ok: false, detail: transportDetail(err).detail };
    }
  }

  /** Poll attachment status to a terminal state (or exhaust the budget). */
  private async pollAttachment(
    patientId: string,
    attachmentId: string
  ): Promise<GentuAttachmentStatus["status"]> {
    let last: GentuAttachmentStatus["status"] = "accepted";
    for (let i = 0; i < ATTACH_POLL_ATTEMPTS; i++) {
      await sleep(ATTACH_POLL_INTERVAL_MS);
      try {
        const s = await this.client.request<GentuAttachmentStatus>(
          "healthcare",
          "GET",
          `/patients/${encodeURIComponent(patientId)}/attachments/${encodeURIComponent(attachmentId)}`
        );
        last = s.status;
        if (s.status === "completed" || s.status === "failed" || s.status === "scanned_infected") {
          return s.status;
        }
      } catch {
        // transient read error mid-poll — keep trying within the budget
      }
    }
    return last;
  }

  // ── METADATA ──
  capabilities(): PmsCapabilities {
    return CAPABILITIES;
  }

  fieldCatalogue(): PmsFieldCatalogueEntry[] {
    return GENTU_FIELD_CATALOGUE;
  }

  validateField(key: string, value: string): PmsFieldValidation {
    return validateCatalogueValue(catalogueEntry(key), value, this.displayName);
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  webLinkForPatient(externalId: string): string | null {
    // No documented patient web-app URL → the "Open in Gentu" button hides.
    return null;
  }

  credentialFields(): PmsCredentialField[] {
    return CREDENTIAL_FIELDS;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function isoNow(): string {
  return new Date().toISOString();
}

function isoDaysFromNow(days: number): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

/** Translate a Gentu transport/fault error into an actionable result. */
function transportDetail(err: GentuApiError): {
  failureKind: PmsFailureKind;
  detail: string;
} {
  if (err.status === 401 || err.status === 403) {
    return {
      failureKind: "auth",
      detail: "Gentu connection rejected — reconnect the integration in Settings.",
    };
  }
  if (err.status === 0) {
    return { failureKind: "transport", detail: "Couldn't reach Gentu — try again." };
  }
  if (err.status === 400 || err.status === 422) {
    // Gentu validation errors carry a specific message via the fault payload.
    return { failureKind: "validation", detail: err.message };
  }
  return { failureKind: "transport", detail: `Gentu error (${err.status}).` };
}

export const gentuFactory: PmsAdapterFactory = {
  provider: "gentu",
  displayName: "Gentu",
  create({
    connectionId,
    credentials,
  }: {
    connectionId: string;
    credentials: PmsCredentials;
    webHint?: string | null;
  }) {
    const app = gentuAppCredentialsFromEnv();
    if (!app) {
      throw new GentuApiError(
        "Gentu app credentials missing (set GENTU_API_KEY / GENTU_API_KEY_SECRET / GENTU_APP_ID).",
        0
      );
    }
    // The per-clinic secret is the tenantId, captured at connect via the
    // pairing code (see exchangeCredentials). It rides in the credentials blob.
    return new GentuAdapter(connectionId, app, credentials.tenant_id ?? "");
  },
  /**
   * Exchange the one-time `pairing_code` from the connect form for a durable
   * `tenant_id` (plan §3). The pairing code is single-use, so we consume it here
   * — at connect, before verify — and store only the tenantId.
   */
  async exchangeCredentials(input: PmsCredentials) {
    const app = gentuAppCredentialsFromEnv();
    if (!app) {
      return {
        ok: false as const,
        detail:
          "Gentu isn't configured on this server (missing app credentials). Contact support.",
      };
    }
    const code = input.pairing_code?.trim();
    if (!code) {
      return { ok: false as const, detail: "Enter the pairing code from Gentu." };
    }
    // No tenant yet — this call obtains it.
    const client = new GentuClient(app, null);
    const res = await client.consumePairingCode(code);
    if (!res.ok || !res.tenantId) {
      return {
        ok: false as const,
        detail: res.detail ?? "Gentu rejected the pairing code.",
      };
    }
    return { ok: true as const, credentials: { tenant_id: res.tenantId } };
  },
  staticMetadata() {
    return {
      capabilities: CAPABILITIES,
      fieldCatalogue: GENTU_FIELD_CATALOGUE,
      credentialFields: CREDENTIAL_FIELDS,
    };
  },
};
