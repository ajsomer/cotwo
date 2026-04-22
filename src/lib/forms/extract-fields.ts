/**
 * Flatten a SurveyJS-style form schema and a response payload into an ordered
 * list of `{ label, value }` rows for inline review (e.g. the readiness
 * handoff panels). Used by both the deliver_form and intake-package handoff
 * APIs so the shape stays consistent as the schema evolves.
 *
 * SurveyJS schemas can nest: `pages → elements → (panel.elements)*`. Panels
 * (`type: 'panel'`) wrap a logical group of inputs and don't themselves
 * collect a response. We walk recursively and emit rows only for leaf inputs
 * — anything that has its own `name` and isn't a panel.
 */

export interface FormFieldRow {
  label: string;
  value: string;
}

interface SurveyElement {
  name?: string;
  title?: string;
  type?: string;
  elements?: SurveyElement[];
  templateElements?: SurveyElement[];
}

const PANEL_TYPES = new Set(["panel", "paneldynamic"]);

export function extractFieldsFromSchema(
  schema: Record<string, unknown>,
  responses: Record<string, unknown>
): FormFieldRow[] {
  const fields: FormFieldRow[] = [];

  const pages = (schema as { pages?: SurveyElement[] }).pages;
  if (pages) {
    for (const page of pages) {
      walk(page.elements ?? [], responses, fields);
    }
  }

  if (fields.length === 0) {
    const elements = (schema as { elements?: SurveyElement[] }).elements;
    if (elements) walk(elements, responses, fields);
  }

  // Fallback: response keys with no schema mapping.
  if (fields.length === 0) {
    for (const [key, value] of Object.entries(responses)) {
      fields.push({ label: key, value: formatValue(value) });
    }
  }

  return fields;
}

function walk(
  elements: SurveyElement[],
  responses: Record<string, unknown>,
  out: FormFieldRow[]
): void {
  for (const element of elements) {
    if (element.type && PANEL_TYPES.has(element.type)) {
      // Recurse into the panel's children. Panels don't carry a response of
      // their own — only their leaf inputs do.
      const children = element.elements ?? element.templateElements ?? [];
      walk(children, responses, out);
      continue;
    }

    if (!element.name) continue;
    out.push({
      label: element.title ?? element.name,
      value: formatValue(responses[element.name]),
    });
  }
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.join(", ");
  return JSON.stringify(value);
}
