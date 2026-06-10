import "server-only";
/**
 * Shared write-path machinery for PMS adapters.
 *
 * The push orchestration, fill-blanks-only engine, and catalogue validation are
 * identical across providers — only the API calls, field-name maps, and error
 * translation differ. Adapters supply those as hooks; everything else lives
 * here so provider #3 doesn't copy the skeleton a third time (and so the
 * skeleton's safety rules — fail-all on an unreadable patient record, never
 * overwrite existing PMS data — hold by construction).
 */
import type { PmsFieldCatalogueEntry, PmsFieldValidation } from "./adapter";
import type {
  PmsFailureKind,
  PmsFieldResult,
  PmsFormFieldInput,
  PmsFormSubmissionInput,
  PmsPushResult,
} from "./types";
import { getPatientExternalId } from "./sync/mapping";

/** Provider-specific error translated into an actionable failure. */
export interface PmsErrorDetail {
  failureKind: PmsFailureKind;
  detail: string;
}

/** Build a failed result row for a field. */
export function failResult(
  f: PmsFormFieldInput,
  failureKind: PmsFailureKind,
  detail: string
): PmsFieldResult {
  return {
    coviuQuestionName: f.questionName,
    target: f.targetKey,
    label: f.label,
    attemptedValue: f.value,
    status: "failed",
    failureKind,
    detail,
  };
}

/**
 * Catalogue-driven value validation. Operates purely on the catalogue entry —
 * nothing provider-specific beyond the label in the messages. Adapters with
 * genuinely custom rules (e.g. a Medicare check digit) validate those on top.
 */
export function validateCatalogueValue(
  entry: PmsFieldCatalogueEntry | undefined,
  value: string,
  providerLabel: string
): PmsFieldValidation {
  if (!entry) {
    return {
      ok: false,
      failureKind: "mapping",
      detail: `Unknown ${providerLabel} field.`,
    };
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
          detail: `${providerLabel} expects a date as YYYY-MM-DD.`,
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
          detail: `${providerLabel} doesn't recognise "${trimmed}" for ${entry.label}. Expected one of: ${entry.enumChoices.join(", ")}.`,
        };
      }
      return { ok: true };
    default:
      return { ok: true };
  }
}

export interface FillBlanksHooks {
  providerLabel: string;
  /**
   * The patient's CURRENT record on the PMS side, as a flat field→value map.
   * Return null when the record can't be found/read — every field then fails
   * (we never treat an unreadable record as "all blank": that would turn
   * fill-blanks-only into overwrite-everything).
   */
  readCurrent(): Promise<Record<string, unknown> | null>;
  /** Catalogue key → API write-param name. Unknown key → mapping failure. */
  writeParamFor(key: string): string | undefined;
  /**
   * Catalogue key → field name on the readCurrent() record for the blank
   * check, where the provider's read/write names differ (e.g. Nookal reads
   * PascalCase, writes snake_case). Defaults to writeParamFor.
   */
  readFieldFor?(key: string): string | undefined;
  validate(key: string, value: string): PmsFieldValidation;
  /** One write for the whole patch (the happy path). */
  writeBatch(patch: Record<string, string>): Promise<void>;
  /** Single-field write, used to isolate the offender when a batch rejects. */
  writeOne(param: string, value: string): Promise<void>;
  /** Provider-specific error → actionable failureKind/detail. */
  mapError(e: unknown): PmsErrorDetail;
}

/**
 * Fill-blanks-only patient-field write: read the current record, write only
 * currently-empty fields (never clobber clinic-entered data), return a
 * per-field result. On a batch rejection, retries each field in isolation so
 * one invalid value doesn't poison the rest.
 */
export async function fillBlanksWrite(
  fields: PmsFormFieldInput[],
  hooks: FillBlanksHooks
): Promise<PmsFieldResult[]> {
  let current: Record<string, unknown>;
  try {
    const raw = await hooks.readCurrent();
    if (raw === null) {
      return fields.map((f) =>
        failResult(
          f,
          "mapping",
          `Couldn't find this patient in ${hooks.providerLabel} — nothing was written.`
        )
      );
    }
    current = raw;
  } catch (e) {
    const detail = hooks.mapError(e);
    return fields.map((f) => failResult(f, detail.failureKind, detail.detail));
  }

  const patch: Record<string, string> = {};
  const results: PmsFieldResult[] = [];

  for (const f of fields) {
    const writeParam = hooks.writeParamFor(f.targetKey);
    if (!writeParam) {
      results.push(
        failResult(f, "mapping", `Unknown ${hooks.providerLabel} field.`)
      );
      continue;
    }
    // Callers filter blank answers before pushing; enforce it here too so a
    // stray empty value can never be written into a blank PMS field and
    // reported "written".
    if (f.value.trim() === "") {
      results.push(
        failResult(f, "validation", "Nothing to write — the value is empty.")
      );
      continue;
    }
    const v = hooks.validate(f.targetKey, f.value);
    if (!v.ok) {
      results.push(failResult(f, v.failureKind, v.detail));
      continue;
    }
    const readField = hooks.readFieldFor
      ? hooks.readFieldFor(f.targetKey)
      : writeParam;
    const existing = readField ? current[readField] : undefined;
    if (existing !== null && existing !== undefined && existing !== "") {
      results.push({
        coviuQuestionName: f.questionName,
        target: f.targetKey,
        label: f.label,
        attemptedValue: f.value,
        status: "skipped_existing",
        detail: `Kept the value already in ${hooks.providerLabel}.`,
      });
      continue;
    }
    patch[writeParam] = f.value;
    // Tentatively mark written; flip to failed if the write errors.
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
      // Happy path: one write for everything.
      await hooks.writeBatch(patch);
    } catch {
      // A single invalid field can reject the whole batch. Don't poison the
      // good fields — retry each on its own so valid ones still land and only
      // the offender is marked failed with the provider's specific message.
      for (const r of toWrite) {
        const param = hooks.writeParamFor(r.target);
        if (!param) continue;
        try {
          await hooks.writeOne(param, r.attemptedValue);
          // stays "written"
        } catch (e2) {
          const detail = hooks.mapError(e2);
          r.status = "failed";
          r.failureKind = detail.failureKind;
          r.detail = detail.detail;
        }
      }
    }
  }
  return results;
}

export interface PushOrchestrationHooks {
  providerLabel: string;
  catalogueEntry(key: string): PmsFieldCatalogueEntry | undefined;
  writePatientFields(
    externalId: string,
    fields: PmsFormFieldInput[]
  ): Promise<PmsFieldResult[]>;
  /**
   * Post/PATCH the form-answer bundle (writeForms providers only). Omit when
   * the provider can't carry form answers — its catalogue then has no
   * form_answer entries, so the leg never runs.
   */
  writeFormAnswers?(
    externalId: string,
    formName: string,
    fields: PmsFormFieldInput[],
    existingFormId?: string
  ): Promise<{ id?: string; fieldResults: PmsFieldResult[] }>;
}

/**
 * The provider-agnostic pushFormSubmission skeleton: resolve the PMS patient
 * id from the connection-scoped link table, split fields by the catalogue's
 * writeMode, run the patient-field and form-answer legs, report unmapped
 * fields. Adapters supply only the concrete writes.
 */
export async function orchestratePush(
  input: PmsFormSubmissionInput,
  hooks: PushOrchestrationHooks
): Promise<PmsPushResult> {
  const externalId = await getPatientExternalId(
    input.connectionId,
    input.patientId
  );
  if (!externalId) {
    return {
      fields: input.fields.map((f) =>
        failResult(
          f,
          "mapping",
          `This patient isn't linked to ${hooks.providerLabel} yet.`
        )
      ),
    };
  }

  const patientFields = input.fields.filter(
    (f) => hooks.catalogueEntry(f.targetKey)?.writeMode === "patient_field"
  );
  const formAnswers = input.fields.filter(
    (f) => hooks.catalogueEntry(f.targetKey)?.writeMode === "form_answer"
  );
  const unmapped = input.fields.filter((f) => !hooks.catalogueEntry(f.targetKey));

  const results: PmsFieldResult[] = [];

  // 1. Patient fields — fill-blanks-only write.
  if (patientFields.length > 0) {
    results.push(...(await hooks.writePatientFields(externalId, patientFields)));
  }

  // 2. Form answers (writeForms providers only).
  let createdFormId: string | undefined = input.existingFormExternalId;
  if (formAnswers.length > 0) {
    if (hooks.writeFormAnswers) {
      const { id, fieldResults } = await hooks.writeFormAnswers(
        externalId,
        input.formName,
        formAnswers,
        input.existingFormExternalId
      );
      createdFormId = id ?? input.existingFormExternalId;
      results.push(...fieldResults);
    } else {
      // Catalogue declares form_answer targets but the adapter has no sink —
      // a wiring bug; surface it rather than silently dropping the answers.
      results.push(
        ...formAnswers.map((f) =>
          failResult(
            f,
            "mapping",
            `${hooks.providerLabel} can't carry form answers.`
          )
        )
      );
    }
  }

  // 3. Unmapped answers — informational.
  for (const f of unmapped) {
    results.push({
      coviuQuestionName: f.questionName,
      target: f.targetKey,
      label: f.label,
      attemptedValue: f.value,
      status: "unmapped",
      detail: `No ${hooks.providerLabel} target — stays in Coviu only.`,
    });
  }

  return { externalId: createdFormId, fields: results };
}
