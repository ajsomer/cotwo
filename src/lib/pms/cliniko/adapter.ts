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
import {
  ClinikoApiError,
  ClinikoClient,
  baseUrlForKey,
  webHostForShard,
} from "./client";
import {
  clinikoTimestamp,
  mapAppointment,
  mapAppointmentType,
  mapBusiness,
  mapPatient,
  mapPractitioner,
} from "./map";
import {
  CLINIKO_FIELD_CATALOGUE,
  CLINIKO_SEX_VALUES,
  PATIENT_PATCH_FIELD,
  catalogueEntry,
} from "./field-map";
import type {
  ClinikoAppointmentType,
  ClinikoBusiness,
  ClinikoIndividualAppointment,
  ClinikoPatient,
  ClinikoPatientForm,
  ClinikoPatientFormPayload,
  ClinikoPatientPatch,
  ClinikoPractitioner,
} from "./types";

const CAPABILITIES: PmsCapabilities = {
  webhooks: false, // Cliniko has no webhooks (plan §2)
  writeForms: true,
  writePatientFields: true,
  writeNotes: false,
  webLinks: true,
};

const CREDENTIAL_FIELDS: PmsCredentialField[] = [
  {
    key: "api_key",
    label: "Cliniko API key",
    inputType: "password",
    placeholder: "MS0xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx-au1",
    helpText:
      "Cliniko → My Info → Manage API keys. The shard (e.g. -au1) is read from the key; no region needed.",
  },
];

class ClinikoAdapter implements PmsAdapter {
  readonly provider = "cliniko";
  readonly displayName = "Cliniko";
  private readonly client: ClinikoClient;
  private readonly shard: string;

  constructor(
    private readonly connectionId: string,
    private readonly apiKey: string
  ) {
    this.client = new ClinikoClient(apiKey);
    this.shard = this.client.shard;
  }

  // ── CONNECTION ──
  async verify(): Promise<{ ok: boolean; detail?: string }> {
    try {
      // Cheap authenticated call: /businesses returns the account's clinics.
      await this.client.request(`${baseUrlForKey(this.apiKey)}/businesses?per_page=1`);
      return { ok: true };
    } catch (e) {
      const err = e as ClinikoApiError;
      if (err.status === 401 || err.status === 403) {
        return { ok: false, detail: "API key rejected by Cliniko." };
      }
      return { ok: false, detail: err.message };
    }
  }

  // ── READ ──
  async *listAppointments(opts: {
    since?: Date;
    businessId?: string;
  }): AsyncIterable<PmsAppointment> {
    const q: string[] = [];
    if (opts.since) q.push(`updated_at:>${clinikoTimestamp(opts.since)}`);
    if (opts.businessId) q.push(`business_id:=${opts.businessId}`);
    for await (const row of this.client.list<ClinikoIndividualAppointment>(
      "individual_appointments",
      "individual_appointments",
      { "q[]": q, sort: "updated_at", order: "asc" }
    )) {
      yield mapAppointment(row);
    }
  }

  async *listPatients(opts: { since?: Date }): AsyncIterable<PmsPatient> {
    const q: string[] = [];
    if (opts.since) q.push(`updated_at:>${clinikoTimestamp(opts.since)}`);
    for await (const row of this.client.list<ClinikoPatient>(
      "patients",
      "patients",
      { "q[]": q, sort: "updated_at", order: "asc" }
    )) {
      yield mapPatient(row);
    }
  }

  async getPatient(externalId: string): Promise<PmsPatient | null> {
    try {
      const row = await this.client.get<ClinikoPatient>(
        `${baseUrlForKey(this.apiKey)}/patients/${externalId}`
      );
      return mapPatient(row);
    } catch (e) {
      if ((e as ClinikoApiError).status === 404) return null;
      throw e;
    }
  }

  async getAppointment(externalId: string): Promise<PmsAppointment | null> {
    try {
      const row = await this.client.get<ClinikoIndividualAppointment>(
        `${baseUrlForKey(this.apiKey)}/individual_appointments/${externalId}`
      );
      return mapAppointment(row);
    } catch (e) {
      if ((e as ClinikoApiError).status === 404) return null;
      throw e;
    }
  }

  async listPractitioners(): Promise<PmsPractitioner[]> {
    const out: PmsPractitioner[] = [];
    for await (const row of this.client.list<ClinikoPractitioner>(
      "practitioners",
      "practitioners"
    )) {
      out.push(mapPractitioner(row));
    }
    return out;
  }

  async listAppointmentTypes(): Promise<PmsAppointmentType[]> {
    const out: PmsAppointmentType[] = [];
    for await (const row of this.client.list<ClinikoAppointmentType>(
      "appointment_types",
      "appointment_types"
    )) {
      out.push(mapAppointmentType(row));
    }
    return out;
  }

  async listBusinesses(): Promise<PmsBusiness[]> {
    const out: PmsBusiness[] = [];
    for await (const row of this.client.list<ClinikoBusiness>(
      "businesses",
      "businesses"
    )) {
      out.push(mapBusiness(row));
    }
    return out;
  }

  // ── WRITE ──
  async pushFormSubmission(
    input: PmsFormSubmissionInput
  ): Promise<PmsPushResult> {
    // Resolve Cliniko patient id from the connection-scoped link table.
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
          detail: "This patient isn't linked to Cliniko yet.",
        })),
      };
    }

    const patientFields = input.fields.filter(
      (f) => catalogueEntry(f.targetKey)?.writeMode === "patient_field"
    );
    const formAnswers = input.fields.filter(
      (f) => catalogueEntry(f.targetKey)?.writeMode === "form_answer"
    );
    const unmapped = input.fields.filter((f) => !catalogueEntry(f.targetKey));

    const results: PmsFieldResult[] = [];

    // 1. Patient fields — fill-blanks-only PATCH.
    if (patientFields.length > 0) {
      results.push(...(await this.writePatientFields(externalId, patientFields)));
    }

    // 2. Self-contained patient_form for the form answers.
    let createdFormId: string | undefined = input.existingFormExternalId;
    if (formAnswers.length > 0) {
      const { id, fieldResults } = await this.writePatientForm(
        externalId,
        input.formName,
        formAnswers,
        input.existingFormExternalId
      );
      createdFormId = id ?? input.existingFormExternalId;
      results.push(...fieldResults);
    }

    // 3. Unmapped answers — informational.
    for (const f of unmapped) {
      results.push({
        coviuQuestionName: f.questionName,
        target: f.targetKey,
        label: f.label,
        attemptedValue: f.value,
        status: "unmapped",
        detail: "No Cliniko target — stays in Coviu only.",
      });
    }

    return { externalId: createdFormId, fields: results };
  }

  /** Fill-blanks-only: read current values, PATCH only currently-empty fields. */
  private async writePatientFields(
    externalId: string,
    fields: PmsFormFieldInput[]
  ): Promise<PmsFieldResult[]> {
    const url = `${baseUrlForKey(this.apiKey)}/patients/${externalId}`;
    let current: ClinikoPatient;
    try {
      current = await this.client.get<ClinikoPatient>(url);
    } catch (e) {
      const detail = transportDetail(e as ClinikoApiError);
      return fields.map((f) => ({
        coviuQuestionName: f.questionName,
        target: f.targetKey,
        label: f.label,
        attemptedValue: f.value,
        status: "failed" as const,
        ...detail,
      }));
    }

    const patch: ClinikoPatientPatch = {};
    const results: PmsFieldResult[] = [];
    const currentRecord = current as unknown as Record<string, unknown>;

    for (const f of fields) {
      const prop = PATIENT_PATCH_FIELD[f.targetKey];
      if (!prop) {
        results.push(failResult(f, "mapping", "Unknown Cliniko field."));
        continue;
      }
      // Validate before attempting.
      const v = this.validateField(f.targetKey, f.value);
      if (!v.ok) {
        results.push(failResult(f, v.failureKind, v.detail));
        continue;
      }
      const existing = currentRecord[prop];
      if (existing !== null && existing !== undefined && existing !== "") {
        results.push({
          coviuQuestionName: f.questionName,
          target: f.targetKey,
          label: f.label,
          attemptedValue: f.value,
          status: "skipped_existing",
          detail: "Kept the value already in Cliniko.",
        });
        continue;
      }
      patch[prop] = f.value;
      // Tentatively mark written; flip to failed if the PATCH errors.
      results.push({
        coviuQuestionName: f.questionName,
        target: f.targetKey,
        label: f.label,
        attemptedValue: f.value,
        status: "written",
      });
    }

    if (Object.keys(patch).length > 0) {
      try {
        await this.client.patch(`/patients/${externalId}`, patch);
      } catch (e) {
        const detail = transportDetail(e as ClinikoApiError);
        // Flip the tentatively-written rows to failed.
        for (const r of results) {
          if (r.status === "written") {
            r.status = "failed";
            r.failureKind = detail.failureKind;
            r.detail = detail.detail;
          }
        }
      }
    }
    return results;
  }

  /** POST a self-contained patient_form, or PATCH an existing one (idempotent). */
  private async writePatientForm(
    externalId: string,
    formName: string,
    fields: PmsFormFieldInput[],
    existingFormId?: string
  ): Promise<{ id?: string; fieldResults: PmsFieldResult[] }> {
    const fieldResults: PmsFieldResult[] = [];
    const questions: ClinikoPatientFormPayload["content"]["sections"][number]["questions"] =
      [];

    for (const f of fields) {
      const v = this.validateField(f.targetKey, f.value);
      if (!v.ok) {
        fieldResults.push(failResult(f, v.failureKind, v.detail));
        continue;
      }
      const entry = catalogueEntry(f.targetKey);
      questions.push({
        name: f.label,
        type: entry?.valueType === "date" ? "date" : "paragraph",
        answer: f.value,
      });
      fieldResults.push({
        coviuQuestionName: f.questionName,
        target: f.targetKey,
        label: f.label,
        attemptedValue: f.value,
        status: "written",
      });
    }

    if (questions.length === 0) {
      return { fieldResults };
    }

    const payload: ClinikoPatientFormPayload = {
      patient_id: Number(externalId),
      name: formName || "Coviu intake",
      content: { sections: [{ name: formName || "Coviu intake", questions }] },
    };

    try {
      // Re-send: PATCH the existing form rather than POSTing a duplicate (§8.G).
      const saved = existingFormId
        ? await this.client.patch<ClinikoPatientForm>(
            `/patient_forms/${existingFormId}`,
            payload
          )
        : await this.client.post<ClinikoPatientForm>("/patient_forms", payload);
      return { id: String(saved.id), fieldResults };
    } catch (e) {
      const detail = transportDetail(e as ClinikoApiError);
      for (const r of fieldResults) {
        if (r.status === "written") {
          r.status = "failed";
          r.failureKind = detail.failureKind;
          r.detail = detail.detail;
        }
      }
      return { fieldResults };
    }
  }

  // ── METADATA ──
  capabilities(): PmsCapabilities {
    return CAPABILITIES;
  }

  fieldCatalogue(): PmsFieldCatalogueEntry[] {
    return CLINIKO_FIELD_CATALOGUE;
  }

  validateField(key: string, value: string): PmsFieldValidation {
    const entry = catalogueEntry(key);
    if (!entry) {
      return { ok: false, failureKind: "mapping", detail: "Unknown Cliniko field." };
    }
    const trimmed = value?.trim() ?? "";
    if (trimmed === "") {
      // Empty values are skipped upstream (nothing to write), not a hard fail.
      return { ok: true };
    }
    switch (entry.valueType) {
      case "date":
        if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
          return {
            ok: false,
            failureKind: "validation",
            detail: "Cliniko expects a date as YYYY-MM-DD.",
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
            detail: `Cliniko doesn't recognise "${trimmed}" for ${entry.label}. Expected one of: ${entry.enumChoices.join(", ")}.`,
          };
        }
        return { ok: true };
      default:
        return { ok: true };
    }
  }

  webLinkForPatient(externalId: string): string | null {
    if (!externalId) return null;
    // ⚠️ Format pinned from community reports (plan §6.2) — verify against a
    // live account; if Cliniko changes it, it's a one-line fix here.
    return `${webHostForShard(this.shard)}/patients/${externalId}`;
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

/** Translate a Cliniko transport error into an actionable failureKind/detail. */
function transportDetail(err: ClinikoApiError): {
  failureKind: PmsFieldResult["failureKind"];
  detail: string;
} {
  if (err.status === 401 || err.status === 403) {
    return {
      failureKind: "auth",
      detail: "Cliniko connection rejected — check the integration in Settings.",
    };
  }
  if (err.status === 422 || err.status === 400) {
    const body = err.body as { errors?: unknown } | string | undefined;
    const msg =
      typeof body === "object" && body?.errors
        ? JSON.stringify(body.errors)
        : "Cliniko rejected the value.";
    return { failureKind: "validation", detail: msg };
  }
  if (err.status === 0) {
    return {
      failureKind: "transport",
      detail: "Couldn't reach Cliniko — try again.",
    };
  }
  return {
    failureKind: "transport",
    detail: `Cliniko error (${err.status}).`,
  };
}

export const clinikoFactory: PmsAdapterFactory = {
  provider: "cliniko",
  displayName: "Cliniko",
  create({ connectionId, credentials }: { connectionId: string; credentials: PmsCredentials }) {
    return new ClinikoAdapter(connectionId, credentials.api_key ?? "");
  },
  staticMetadata() {
    return {
      capabilities: CAPABILITIES,
      fieldCatalogue: CLINIKO_FIELD_CATALOGUE,
      credentialFields: CREDENTIAL_FIELDS,
    };
  },
};

// Re-export so callers don't need to know which file holds these constants.
export { CLINIKO_SEX_VALUES };
