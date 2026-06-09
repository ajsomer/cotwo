/**
 * PDF-specific answer normaliser for SurveyJS-style form responses.
 *
 * Different from extractFieldsFromSchema (used by the readiness transcription
 * handoff): that helper produces flat copy-paste-ready text, comma-joining
 * arrays and JSON-stringifying objects. PDFs read top-to-bottom and need
 * legible structure, not flat text.
 *
 * Returns a normalised representation per question that the renderer can walk
 * without any further format-specific knowledge.
 */

const EM_DASH = "—";

/** SurveyJS element types that display content but collect no response. */
const DISPLAY_ONLY_TYPES = new Set(["html", "image", "expression"]);

export interface SchemaElement {
  type?: string;
  name?: string;
  title?: string;
  inputType?: string;
  choices?: Array<string | { value: string; text?: string }>;
  rows?: Array<string | { value: string; text?: string }>;
  columns?: Array<string | { value: string; text?: string }>;
  elements?: SchemaElement[];
  pages?: Array<{ elements?: SchemaElement[] }>;
}

export interface SchemaRoot {
  pages?: Array<{ elements?: SchemaElement[] }>;
  elements?: SchemaElement[];
}

export type NormalisedAnswer =
  | { kind: "scalar"; value: string }
  | { kind: "multiline"; value: string }
  | { kind: "list"; values: string[] }
  | { kind: "matrix"; rows: Array<{ label: string; value: string }> }
  | { kind: "object"; entries: Array<{ label: string; value: string }> }
  | { kind: "file"; placeholder: string }
  | { kind: "empty" };

export interface NormalisedQuestion {
  name: string;
  label: string;
  answer: NormalisedAnswer;
}

const LOCALE = "en-AU";

function isEmpty(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "string" && value.trim() === "") return true;
  if (Array.isArray(value) && value.length === 0) return true;
  if (typeof value === "object" && Object.keys(value as object).length === 0) return true;
  return false;
}

function choiceLabel(
  choices: SchemaElement["choices"] | SchemaElement["rows"] | SchemaElement["columns"],
  raw: unknown,
): string {
  if (raw === null || raw === undefined) return "";
  const rawStr = String(raw);
  if (!choices) return rawStr;
  for (const choice of choices) {
    if (typeof choice === "string") {
      if (choice === rawStr) return choice;
    } else if (choice.value === rawStr) {
      return choice.text ?? choice.value;
    }
  }
  return rawStr;
}

function formatScalar(value: unknown): string {
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") {
    // ISO date detection: YYYY-MM-DD or YYYY-MM-DDT...
    if (/^\d{4}-\d{2}-\d{2}/.test(value)) {
      const d = new Date(value);
      if (!Number.isNaN(d.getTime())) {
        return d.toLocaleDateString(LOCALE, {
          day: "numeric",
          month: "short",
          year: "numeric",
        });
      }
    }
    return value;
  }
  return String(value);
}

function isMultiline(field: SchemaElement): boolean {
  return field.type === "comment" || field.type === "longtext";
}

function isFile(field: SchemaElement): boolean {
  return field.type === "file";
}

export function normaliseAnswer(field: SchemaElement, raw: unknown): NormalisedAnswer {
  if (isEmpty(raw)) {
    if (isFile(field)) {
      return { kind: "file", placeholder: `(file attached ${EM_DASH} view in Coviu)` };
    }
    return { kind: "empty" };
  }

  if (isFile(field)) {
    // v1: don't render attachments inline in the PDF; show a placeholder.
    return { kind: "file", placeholder: `(file attached ${EM_DASH} view in Coviu)` };
  }

  if (isMultiline(field)) {
    return { kind: "multiline", value: String(raw) };
  }

  // Single-select (radio / dropdown / boolean choices)
  if (field.type === "radiogroup" || field.type === "dropdown" || field.type === "boolean") {
    return { kind: "scalar", value: choiceLabel(field.choices, raw) };
  }

  // Multi-select (checkbox, tagbox, multi-dropdown)
  if (field.type === "checkbox" || field.type === "tagbox") {
    if (Array.isArray(raw)) {
      const labels = raw.map((v) => choiceLabel(field.choices, v));
      return { kind: "list", values: labels };
    }
    return { kind: "scalar", value: choiceLabel(field.choices, raw) };
  }

  // Matrix-style questions (single-choice per row)
  if (field.type === "matrix" && raw && typeof raw === "object" && !Array.isArray(raw)) {
    const rows: Array<{ label: string; value: string }> = [];
    for (const [rowKey, rowValue] of Object.entries(raw as Record<string, unknown>)) {
      const rowLabel = choiceLabel(field.rows, rowKey);
      const valueLabel = choiceLabel(field.columns, rowValue);
      rows.push({ label: rowLabel, value: valueLabel });
    }
    return { kind: "matrix", rows };
  }

  // Object/composite answers (rare): one labelled line per sub-field
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const entries: Array<{ label: string; value: string }> = [];
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      entries.push({ label: key, value: formatScalar(value) });
    }
    return { kind: "object", entries };
  }

  // Plain arrays without explicit choices
  if (Array.isArray(raw)) {
    return { kind: "list", values: raw.map((v) => formatScalar(v)) };
  }

  return { kind: "scalar", value: formatScalar(raw) };
}

/**
 * Walk a SurveyJS schema (pages → elements, or top-level elements) in display
 * order, pairing each leaf field with its response value.
 */
export function normaliseQuestions(
  schema: SchemaRoot | null | undefined,
  responses: Record<string, unknown>,
): NormalisedQuestion[] {
  const out: NormalisedQuestion[] = [];

  function walk(elements: SchemaElement[] | undefined) {
    if (!elements) return;
    for (const el of elements) {
      // Panels / nested groups
      if (el.elements && el.elements.length > 0) {
        walk(el.elements);
        continue;
      }
      // Display-only elements (html, image, expression) carry no response —
      // skip them so they don't render as empty field rows.
      if (DISPLAY_ONLY_TYPES.has(el.type ?? "")) continue;
      const name = el.name;
      if (!name) continue;
      const label = el.title ?? name;
      const answer = normaliseAnswer(el, responses[name]);
      out.push({ name, label, answer });
    }
  }

  if (schema?.pages) {
    for (const page of schema.pages) walk(page.elements);
  }
  if (schema?.elements) walk(schema.elements);

  return out;
}
