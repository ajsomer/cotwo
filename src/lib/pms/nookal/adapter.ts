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
  PmsFieldResult,
  PmsFormFieldInput,
  PmsFormSubmissionInput,
  PmsPatient,
  PmsPractitioner,
  PmsPushResult,
} from "../types";
import { getPatientExternalId } from "../sync/mapping";
import { NookalApiError, NookalClient } from "./client";
import {
  mapAppointment,
  mapBusiness,
  mapPatient,
  mapPractitioner,
  mapService,
  nookalTimestamp,
} from "./map";
import {
  NOOKAL_FIELD_CATALOGUE,
  NOOKAL_GENDER_VALUES,
  PATIENT_PATCH_FIELD,
  catalogueEntry,
} from "./field-map";
import type {
  NookalAppointment,
  NookalLocation,
  NookalPatient,
  NookalPatientPatch,
  NookalPractitioner,
  NookalService,
  NookalUploadInit,
} from "./types";

/**
 * Nookal adapter. Plan docs/plans/nookal-integration.md.
 *
 * Capabilities reflect what Nookal ACTUALLY supports:
 * - writePatientFields: true  (patient-update endpoint)
 * - writeForms:         FALSE (addTreatmentNote needs case_id + practitioner_id
 *                              the canonical input can't resolve safely — §5)
 * - writeAttachments:   true  (3-step uploadFile → presigned PUT → setFileActive)
 * - webLinks:           FALSE (no documented patient web-app URL — §5 finding 6)
 * - webhooks:           false (polling)
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
    key: "api_key",
    label: "Nookal API key",
    inputType: "password",
    placeholder: "Your Nookal API key",
    helpText:
      "Nookal → Practice → Setup → API Keys. The key is location-scoped; store it encrypted.",
  },
];

class NookalAdapter implements PmsAdapter {
  readonly provider = "nookal";
  readonly displayName = "Nookal";
  private readonly client: NookalClient;

  constructor(
    private readonly connectionId: string,
    apiKey: string
  ) {
    this.client = new NookalClient(apiKey);
  }

  // ── CONNECTION ──
  async verify(): Promise<{ ok: boolean; detail?: string }> {
    try {
      // Cheapest authenticated call: /verify validates the key.
      await this.client.request("verify");
      return { ok: true };
    } catch (e) {
      const err = e as NookalApiError;
      if (err.status === 401 || err.status === 403) {
        return { ok: false, detail: "API key rejected by Nookal." };
      }
      return { ok: false, detail: err.message };
    }
  }

  // ── READ ──
  /**
   * INCREMENTAL via `last_modified` (plan §4): the Nookal docs document a
   * last_modified filter on getAppointments, so we honour `opts.since` and let
   * the generic cursor advance to max(updatedAt). page/page_length pagination is
   * handled by the client. ⚠️ Verify on a live account that last_modified
   * filters as documented; if not, fall back to a date-windowed pull.
   */
  async *listAppointments(opts: {
    since?: Date;
    businessId?: string;
  }): AsyncIterable<PmsAppointment> {
    const params: Record<string, string | number> = {};
    if (opts.since) params.last_modified = nookalTimestamp(opts.since);
    if (opts.businessId) params.location_id = opts.businessId;
    for await (const row of this.client.list<NookalAppointment>(
      "getAppointments",
      "appointments",
      params
    )) {
      yield mapAppointment(row);
    }
  }

  async *listPatients(opts: { since?: Date }): AsyncIterable<PmsPatient> {
    const params: Record<string, string | number> = {};
    if (opts.since) params.last_modified = nookalTimestamp(opts.since);
    for await (const row of this.client.list<NookalPatient>(
      "getPatients",
      "patients",
      params
    )) {
      yield mapPatient(row);
    }
  }

  async getPatient(externalId: string): Promise<PmsPatient | null> {
    const row = await this.fetchRawPatient(externalId);
    return row ? mapPatient(row) : null;
  }

  /**
   * Fetch a single raw patient by exact id match. searchPatients with
   * patient_id returns the record(s) under `patients`. We require an exact ID
   * match (never rows[0]) so a non-filtering response can't return the wrong
   * patient. ⚠️ Verify `patient_id` filters searchPatients on a live account.
   */
  private async fetchRawPatient(
    externalId: string
  ): Promise<NookalPatient | null> {
    const env = await this.client.request<NookalPatient>("searchPatients", {
      patient_id: externalId,
    });
    const rows =
      (env.data?.results?.patients as NookalPatient[] | undefined) ?? [];
    return rows.find((p) => String(p.ID) === String(externalId)) ?? null;
  }

  async getAppointment(externalId: string): Promise<PmsAppointment | null> {
    // No single-appointment endpoint; filter the list by id (cheap: id-scoped).
    // ⚠️ If `appointment_id` isn't a real server-side filter, Nookal returns the
    // first page of ALL appointments — so we ONLY accept an exact id match and
    // never fall back to rows[0] (that would return the wrong record).
    const env = await this.client.request<NookalAppointment>("getAppointments", {
      appointment_id: externalId,
    });
    const rows =
      (env.data?.results?.appointments as NookalAppointment[] | undefined) ?? [];
    const row = rows.find((a) => String(a.ID) === String(externalId));
    return row ? mapAppointment(row) : null;
  }

  async listPractitioners(): Promise<PmsPractitioner[]> {
    const rows = await this.client.listOnce<NookalPractitioner>(
      "getPractitioners",
      "practitioners"
    );
    return rows.map(mapPractitioner);
  }

  async listAppointmentTypes(): Promise<PmsAppointmentType[]> {
    // ⚠️ getServices keys unverified (reference client doesn't fetch services);
    // map.ts reads defensively. Verify the function name + result key live.
    const rows = await this.client.listOnce<NookalService>(
      "getServices",
      "services"
    );
    return rows.map(mapService);
  }

  async listBusinesses(): Promise<PmsBusiness[]> {
    const rows = await this.client.listOnce<NookalLocation>(
      "getLocations",
      "locations"
    );
    return rows.map(mapBusiness);
  }

  // ── WRITE ──
  async pushFormSubmission(
    input: PmsFormSubmissionInput
  ): Promise<PmsPushResult> {
    const externalId = await getPatientExternalId(
      input.connectionId,
      input.patientId
    );
    if (!externalId) {
      return {
        fields: input.fields.map((f) => ({
          coviuQuestionName: f.questionName,
          target: f.targetKey,
          label: f.label,
          attemptedValue: f.value,
          status: "failed" as const,
          failureKind: "mapping" as const,
          detail: "This patient isn't linked to Nookal yet.",
        })),
      };
    }

    // writeForms is false → there are no form_answer targets. Everything is
    // either a patient_field write or unmapped.
    const patientFields = input.fields.filter(
      (f) => catalogueEntry(f.targetKey)?.writeMode === "patient_field"
    );
    const unmapped = input.fields.filter((f) => !catalogueEntry(f.targetKey));

    const results: PmsFieldResult[] = [];
    if (patientFields.length > 0) {
      results.push(...(await this.writePatientFields(externalId, patientFields)));
    }
    for (const f of unmapped) {
      results.push({
        coviuQuestionName: f.questionName,
        target: f.targetKey,
        label: f.label,
        attemptedValue: f.value,
        status: "unmapped",
        detail: "No Nookal target — stays in Coviu only.",
      });
    }
    return { fields: results };
  }

  /**
   * Fill-blanks-only: read the current patient, PATCH only currently-empty
   * fields, so we never clobber clinic-entered data.
   *
   * ⚠️ Nookal's patient-update endpoint name + accepted fields are unverified.
   * We use `updatePatient` (conventional) and surface any rejection per-field
   * with an actionable message. Verify against a live account before the first
   * real write (operational guardrail — manual sign-off required).
   */
  private async writePatientFields(
    externalId: string,
    fields: PmsFormFieldInput[]
  ): Promise<PmsFieldResult[]> {
    // Read current values to honour fill-blanks-only (exact-id match only).
    let current: Record<string, unknown> = {};
    try {
      const raw = await this.fetchRawPatient(externalId);
      current = (raw ?? {}) as unknown as Record<string, unknown>;
    } catch (e) {
      const detail = transportDetail(e as NookalApiError);
      return fields.map((f) => ({
        coviuQuestionName: f.questionName,
        target: f.targetKey,
        label: f.label,
        attemptedValue: f.value,
        status: "failed" as const,
        ...detail,
      }));
    }

    const patch: NookalPatientPatch = {};
    const results: PmsFieldResult[] = [];

    for (const f of fields) {
      const prop = PATIENT_PATCH_FIELD[f.targetKey];
      if (!prop) {
        results.push(failResult(f, "mapping", "Unknown Nookal field."));
        continue;
      }
      const v = this.validateField(f.targetKey, f.value);
      if (!v.ok) {
        results.push(failResult(f, v.failureKind, v.detail));
        continue;
      }
      const existing = current[prop];
      if (existing !== null && existing !== undefined && existing !== "") {
        results.push({
          coviuQuestionName: f.questionName,
          target: f.targetKey,
          label: f.label,
          attemptedValue: f.value,
          status: "skipped_existing",
          detail: "Kept the value already in Nookal.",
        });
        continue;
      }
      patch[prop] = f.value;
      results.push({
        coviuQuestionName: f.questionName,
        target: f.targetKey,
        label: f.label,
        attemptedValue: f.value,
        status: "written",
      });
    }

    const toWrite = results.filter((r) => r.status === "written");
    if (toWrite.length > 0) {
      try {
        await this.client.request("updatePatient", {
          patient_id: externalId,
          ...stringifyPatch(patch),
        });
      } catch {
        // A single invalid field can reject the batch; retry each in isolation
        // so valid fields still land and only the offender is marked failed.
        for (const r of toWrite) {
          const prop = PATIENT_PATCH_FIELD[r.target];
          if (!prop) continue;
          try {
            await this.client.request("updatePatient", {
              patient_id: externalId,
              [prop]: r.attemptedValue,
            });
          } catch (e2) {
            const detail = transportDetail(e2 as NookalApiError);
            r.status = "failed";
            r.failureKind = detail.failureKind;
            r.detail = detail.detail;
          }
        }
      }
    }
    return results;
  }

  /**
   * Attach a file to a patient via Nookal's 3-step Documents flow (plan §5):
   *   1. POST /uploadFile  → { file_id, url }  (presigned upload target)
   *   2. PUT the bytes to `url`
   *   3. POST /setFileActive { file_id, patient_id }
   * case_id is optional; omitted unless supplied.
   */
  async uploadPatientAttachment(input: {
    externalId: string;
    fileName: string;
    contentType: string;
    contentBase64: string;
    description?: string;
  }): Promise<{ ok: boolean; attachmentId?: string; detail?: string }> {
    const dotIdx = input.fileName.lastIndexOf(".");
    const extension =
      dotIdx >= 0 ? input.fileName.slice(dotIdx + 1).toLowerCase() : "";
    const name =
      dotIdx >= 0 ? input.fileName.slice(0, dotIdx) : input.fileName;
    try {
      // 1. Initialise the upload → file_id + presigned url.
      const env = await this.client.request<NookalUploadInit>("uploadFile", {
        patient_id: input.externalId,
        name: input.description || name,
        extension,
        file_type: input.contentType,
      });
      const results = env.data?.results ?? {};
      const fileId = scalarResult(results, "file_id");
      const url = scalarResult(results, "url");
      if (!fileId || !url) {
        return { ok: false, detail: "Nookal didn't return an upload target." };
      }

      // 2. PUT the bytes to the presigned URL.
      const bytes = Buffer.from(input.contentBase64, "base64");
      const put = await fetch(url, {
        method: "PUT",
        headers: { "Content-Type": input.contentType },
        body: bytes,
      });
      if (!put.ok) {
        const body = await put.text().catch(() => "");
        console.error("[nookal attach] PUT failed:", put.status, body);
        return { ok: false, detail: `Upload to storage failed (${put.status}).` };
      }

      // 3. Activate the file against the patient.
      await this.client.request("setFileActive", {
        file_id: fileId,
        patient_id: input.externalId,
      });
      return { ok: true, attachmentId: fileId };
    } catch (e) {
      const err = e as NookalApiError;
      console.error("[nookal attach] error:", err.status, JSON.stringify(err.body));
      return { ok: false, detail: transportDetail(err).detail };
    }
  }

  // ── METADATA ──
  capabilities(): PmsCapabilities {
    return CAPABILITIES;
  }

  fieldCatalogue(): PmsFieldCatalogueEntry[] {
    return NOOKAL_FIELD_CATALOGUE;
  }

  validateField(key: string, value: string): PmsFieldValidation {
    const entry = catalogueEntry(key);
    if (!entry) {
      return { ok: false, failureKind: "mapping", detail: "Unknown Nookal field." };
    }
    const trimmed = value?.trim() ?? "";
    if (trimmed === "") return { ok: true }; // empty → skipped upstream
    switch (entry.valueType) {
      case "date":
        if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
          return {
            ok: false,
            failureKind: "validation",
            detail: "Nookal expects a date as YYYY-MM-DD.",
          };
        }
        return { ok: true };
      case "phone":
        if (!/^\+?[0-9 ()-]{6,20}$/.test(trimmed)) {
          return {
            ok: false,
            failureKind: "validation",
            detail: "Not a valid phone number.",
          };
        }
        return { ok: true };
      case "enum":
        if (entry.enumChoices && !entry.enumChoices.includes(trimmed)) {
          return {
            ok: false,
            failureKind: "validation",
            detail: `Nookal doesn't recognise "${trimmed}" for ${entry.label}. Expected one of: ${entry.enumChoices.join(", ")}.`,
          };
        }
        return { ok: true };
      default:
        return { ok: true };
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  webLinkForPatient(externalId: string): string | null {
    // No documented patient web-app URL (plan §5 finding 6). Returns null →
    // the "Open in Nookal" button hides. Implement if a live account confirms a
    // stable URL pattern.
    return null;
  }

  credentialFields(): PmsCredentialField[] {
    return CREDENTIAL_FIELDS;
  }
}

function failResult(
  f: PmsFormFieldInput,
  failureKind: string,
  detail: string
): PmsFieldResult {
  return {
    coviuQuestionName: f.questionName,
    target: f.targetKey,
    label: f.label,
    attemptedValue: f.value,
    status: "failed",
    failureKind: failureKind as PmsFieldResult["failureKind"],
    detail,
  };
}

/** Coerce a NookalPatientPatch to string form params for the POST body. */
function stringifyPatch(
  patch: NookalPatientPatch
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(patch)) {
    if (v !== undefined) out[k] = String(v);
  }
  return out;
}

/** Read a scalar (non-array) value out of data.results. */
function scalarResult(
  results: Record<string, unknown>,
  key: string
): string | null {
  const v = results[key];
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  return null;
}

/** Translate a Nookal transport/envelope error into an actionable result. */
function transportDetail(err: NookalApiError): {
  failureKind: PmsFieldResult["failureKind"];
  detail: string;
} {
  if (err.status === 401 || err.status === 403) {
    return {
      failureKind: "auth",
      detail: "Nookal connection rejected — check the integration in Settings.",
    };
  }
  if (err.status === 0) {
    return {
      failureKind: "transport",
      detail: "Couldn't reach Nookal — try again.",
    };
  }
  // Nookal surfaces a human errorMessage in the thrown message (client.ts).
  if (err.status === 422 || err.status === 400 || err.apiErrorCode) {
    return { failureKind: "validation", detail: err.message };
  }
  return { failureKind: "transport", detail: `Nookal error (${err.status}).` };
}

export const nookalFactory: PmsAdapterFactory = {
  provider: "nookal",
  displayName: "Nookal",
  create({
    connectionId,
    credentials,
  }: {
    connectionId: string;
    credentials: PmsCredentials;
    webHint?: string | null;
  }) {
    return new NookalAdapter(connectionId, credentials.api_key ?? "");
  },
  staticMetadata() {
    return {
      capabilities: CAPABILITIES,
      fieldCatalogue: NOOKAL_FIELD_CATALOGUE,
      credentialFields: CREDENTIAL_FIELDS,
    };
  },
};

export { NOOKAL_GENDER_VALUES };
