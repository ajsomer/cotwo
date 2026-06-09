/**
 * Pure helpers for reading pmsTarget bindings out of a SurveyJS form schema.
 * NO survey-core import — safe to use server-side (form PATCH route, push
 * pipeline) without pulling the builder runtime in.
 */

export function collectPmsTargets(
  schema: unknown
): Array<{ questionName: string; target: string; title: string }> {
  const out: Array<{ questionName: string; target: string; title: string }> = [];
  const visit = (el: Record<string, unknown>) => {
    if (Array.isArray(el.pages)) {
      for (const p of el.pages as Record<string, unknown>[]) visit(p);
    }
    if (Array.isArray(el.elements)) {
      for (const child of el.elements as Record<string, unknown>[]) visit(child);
    }
    const target = el.pmsTarget;
    if (typeof target === "string" && target) {
      out.push({
        questionName: String(el.name ?? ""),
        target,
        title: String(el.title ?? el.name ?? ""),
      });
    }
  };
  if (schema && typeof schema === "object") {
    visit(schema as Record<string, unknown>);
  }
  return out;
}

/** Provider from the first namespaced key, or null for a generic form. */
export function derivePmsProviderFromSchema(schema: unknown): string | null {
  for (const { target } of collectPmsTargets(schema)) {
    const idx = target.indexOf(":");
    if (idx > 0) return target.slice(0, idx);
  }
  return null;
}

/** Offending target keys bound more than once (empty = clean). §6 unique rule. */
export function findDuplicatePmsTargets(schema: unknown): string[] {
  const counts = new Map<string, number>();
  for (const { target } of collectPmsTargets(schema)) {
    counts.set(target, (counts.get(target) ?? 0) + 1);
  }
  return [...counts.entries()].filter(([, n]) => n > 1).map(([k]) => k);
}
