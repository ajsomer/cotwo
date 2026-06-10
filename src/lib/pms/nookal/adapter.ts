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
  PATIENT_READ_FIELD,
  PATIENT_WRITE_PARAM,
  catalogueEntry,
} from "./field-map";
import type {
  NookalAppointment,
  NookalLocation,
  NookalPatient,
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
    // VERIFIED against a live account (2026-06-09): the function is
    // `getAppointmentTypes` and the result key is `services` (NOT
    // `appointmentTypes`). Fields: ID, Name, Description, Duration, Category,
    // Price, hasTax, Locations, ServiceCode, active.
    const rows = await this.client.listOnce<NookalService>(
      "getAppointmentTypes",
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
    // writeForms is false → the catalogue has no form_answer targets, so no
    // writeFormAnswers hook: everything is a patient_field write or unmapped.
    return orchestratePush(input, {
      providerLabel: this.displayName,
      catalogueEntry,
      writePatientFields: (externalId, fields) =>
        this.writePatientFields(externalId, fields),
    });
  }

  /**
   * Fill-blanks-only: read the current patient, write only currently-empty
   * fields, so we never clobber clinic-entered data.
   *
   * VERIFIED: the patient-update endpoint is `editPatient`, and it's ASYMMETRIC
   * with reads — editPatient expects snake_case params (date_of_birth/email/…)
   * while getPatients returns PascalCase fields (DOB/Email/…); see the
   * PATIENT_WRITE_PARAM / PATIENT_READ_FIELD note in field-map.ts. An
   * unreadable patient record fails every field (fillBlanksWrite's null
   * contract) — Nookal's editPatient silently ignores unknown params with
   * status:success, so writing blind is never safe.
   */
  private writePatientFields(
    externalId: string,
    fields: PmsFormFieldInput[]
  ): Promise<PmsFieldResult[]> {
    return fillBlanksWrite(fields, {
      providerLabel: this.displayName,
      // null when the patient can't be found (or searchPatients' patient_id
      // filter isn't honoured server-side) → every field fails rather than
      // treating the record as all-blank and overwriting clinic data.
      readCurrent: async () => {
        const raw = await this.fetchRawPatient(externalId);
        return raw ? (raw as unknown as Record<string, unknown>) : null;
      },
      writeParamFor: (key) => PATIENT_WRITE_PARAM[key],
      readFieldFor: (key) => PATIENT_READ_FIELD[key],
      validate: (key, value) => this.validateField(key, value),
      writeBatch: async (patch) => {
        await this.client.request("editPatient", {
          patient_id: externalId,
          ...patch,
        });
      },
      writeOne: async (param, value) => {
        await this.client.request("editPatient", {
          patient_id: externalId,
          [param]: value,
        });
      },
      mapError: (e) => transportDetail(e as NookalApiError),
    });
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
    return validateCatalogueValue(catalogueEntry(key), value, this.displayName);
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
  failureKind: PmsFailureKind;
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
