import { Serializer } from "survey-core";

/**
 * Registers the `pmsTarget` custom property on every SurveyJS question so the
 * builder's Property Grid shows a "Write back to {PMS}" dropdown, and the
 * binding serialises straight into forms.schema (plan §6, Step 6).
 *
 * Provider-neutral by construction: choices come from the active adapter's
 * fieldCatalogue() — the builder never names a provider. Idempotent.
 */

export interface PmsTargetChoice {
  key: string;
  label: string;
  group: string;
}

let registered = false;

export function registerPmsTargetProperty(): void {
  if (registered) return;
  registered = true;

  Serializer.addProperty("question", {
    name: "pmsTarget",
    displayName: "Write back to PMS",
    category: "general",
    type: "dropdown",
    // Choices are populated dynamically via setPmsTargetChoices(); default is
    // "don't send".
    default: "",
    choices: [{ value: "", text: "(Don't send to PMS)" }],
    visibleIndex: 100,
  });
}

/**
 * Update the dropdown choices to the active provider's catalogue. Called once
 * the catalogue is fetched for the form's location. Grouped by catalogue
 * `group` via a "Group — Label" display text (SurveyJS dropdown is flat).
 */
export function setPmsTargetChoices(choices: PmsTargetChoice[]): void {
  registerPmsTargetProperty();
  const prop = Serializer.findProperty("question", "pmsTarget");
  if (!prop) return;
  prop.setChoices([
    { value: "", text: "(Don't send to PMS)" },
    ...choices.map((c) => ({
      value: c.key,
      text: `${c.group} — ${c.label}`,
    })),
  ]);
}

// Pure schema-parsing helpers live in pms-target-schema.ts (no survey-core
// import, so they're safe server-side). Re-exported here for builder callers.
export {
  collectPmsTargets,
  derivePmsProviderFromSchema,
  findDuplicatePmsTargets,
} from "./pms-target-schema";
