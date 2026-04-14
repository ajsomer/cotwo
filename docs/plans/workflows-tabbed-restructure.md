# Refactor the Workflows page to a tabbed pre/post-appointment structure

## Context

The current Workflows page (`workflows-shell.tsx`) has a page-level pre/post-appointment toggle in the top right that switches between two entirely different content surfaces. Pre-appointment renders `AppointmentTypesSettingsShell` (a flat table of all appointment types). Post-appointment renders a sidebar plus middle pane with the granular action block editor. The toggle works but has structural problems:

1. The pre/post split should be the primary navigation for the page, not a small toggle in the header corner.
2. The appointment types table mixes run-sheet-terminating and collection-only packages together, distinguished only by an "On completion" badge column.
3. The "+ New appointment type" button lives inside `AppointmentTypesSettingsShell` at the page level, and creates types without distinguishing terminal type upfront.
4. The appointment type editor exposes a terminal type toggle ("On completion" section) that lets users switch between run_sheet and collection_only. The spec removes this user-facing choice.

This is a UI restructure only. The data model does not change.

## Current file map

| File | Role |
|------|------|
| `src/app/(clinic)/workflows/page.tsx` | Thin wrapper rendering `<WorkflowsShell />` |
| `src/components/clinic/workflows-shell.tsx` | Page shell with direction toggle, pre renders `AppointmentTypesSettingsShell`, post renders sidebar + middle pane |
| `src/components/clinic/appointment-types-settings-shell.tsx` | Pre-appointment table of all appointment types with filters, "On completion" column, "+ New appointment type" button |
| `src/components/clinic/appointment-type-editor.tsx` | Slide-over editor with sections: Details, On completion (terminal type toggle), Intake package, Reminders, Urgency |
| `src/stores/clinic-store.ts` | Zustand store holding `appointmentTypes` (includes `terminal_type` field), `outcomePathways`, workflow templates/blocks |

## Implementation steps

### 1. Replace the header toggle with a tab bar

In `workflows-shell.tsx`:

- Keep the page header (title "Workflows", subtitle "Configure what happens before and after each appointment").
- Remove the pre/post toggle from the top right of the header.
- Below the header, add a tab bar with two tabs: "Pre-appointment" (default active) and "Post-appointment". The tab bar spans the full width below the header border, styled as underline tabs (not the current pill toggle). Active tab gets teal-500 underline and teal text. Inactive gets gray-500 text.
- The tab bar switches the entire content area below it, same as the current toggle does.
- Keep all existing direction-change logic (dirty check, state reset, auto-select).

### 2. Build the Pre-appointment tab content

Replace the current `AppointmentTypesSettingsShell` content with the new structure:

**Remove the filter row entirely.** Delete the search input, source filter, and status filter. Remove all associated state (`search`, `sourceFilter`, `statusFilter`) and the `filteredTypes` memo. At current scale, filters are premature.

**Remove the unconfigured banner.** The amber warning banner ("X appointment types need intake packages configured") is removed.

**Explainer banner plus action button.** At the top of the tab content, render a horizontal row containing:
- Left: a muted rounded rectangle (gray-50 bg, gray-200 border, rounded-xl, px-4 py-3) with the text: "Pre-appointment workflows are triggered when an appointment of a given type is created. Each appointment type has one intake package attached to it." Text is text-sm text-gray-600.
- Right: the "+ New appointment type" button, teal primary style, vertically centred with the banner. The button lives inside the tab content, not in the page header.

**Appointment types table (run_sheet only).** Filter `appointmentTypes` to only those where `terminal_type !== 'collection_only'`. This means rows where `terminal_type` is `'run_sheet'` or `null` (unconfigured) appear here.

Table columns (4 columns, remove "On completion"):
- **Appointment type**: Name only. Remove the "Manually created" / "From PMS" subtitle. Keep the PMS sync icon if `source === "pms"`.
- **Duration**: Same as current (`XX min`).
- **Modality**: Same badge as current.
- **Intake package**: Two-line cell. Line 1: action count or "Not configured". Line 2: when no active runs, muted text "No active runs" (text-xs text-gray-400). When active runs, amber text "X in flight" using `#BA7517` (text-xs font-medium, style color `#BA7517`). The colour shift on active state is important for scannability.

Grid template changes from `[2fr_90px_100px_1.5fr_100px]` to `[2fr_90px_100px_1.5fr]` (drop the last column).

### 3. Add the Standalone collections section

Below the appointment types table, add a new section as a sibling (not nested inside the table container).

**Section heading.** No separate heading element. The heading is inside the banner (see below).

**Explainer banner plus action button.** Same horizontal layout as the appointment types banner above:
- Left: muted banner with text: "**Standalone collections.** Send forms to patients outside of an appointment. Terminates when all forms are returned." The words "Standalone collections" are bold (font-semibold). Rest is normal weight. Same styling as the pre-appointment banner.
- Right: "+ New collection" button, secondary style (white bg, gray-200 border, gray-800 text). Vertically centred.

**Collections table.** Filter `appointmentTypes` to only those where `terminal_type === 'collection_only'`.

Table columns (2 columns):
- **Collection**: Name only (same as appointment type name column, no subtitle).
- **Package**: Two-line cell, same pattern as the intake package column above (action count line 1, run state line 2 with amber "X in flight" when active).

If there are no collection_only types, still show the banner and button but show an empty state below: "No standalone collections yet."

### 4. Wire up creation flows

**"+ New appointment type" button**: Opens the existing `AppointmentTypeEditor` slide-over with `editingType` set to `null` (new type). The editor must hardcode `terminal_type` to `'run_sheet'` for types created from this button. See step 5 for how this is enforced.

**"+ New collection" button**: Opens the same `AppointmentTypeEditor` slide-over but passes a prop (e.g., `forceTerminalType="collection_only"`) that:
- Hardcodes `terminal_type` to `'collection_only'`
- Disables the duration and modality fields (already happens when `terminalType === 'collection_only'`)
- Hides the "On completion" section entirely (since the terminal type is predetermined)

Both buttons determine the terminal type. The user never sees the choice.

### 5. Remove the terminal type toggle from the editor

In `appointment-type-editor.tsx`:

- Accept a new prop `forceTerminalType?: 'run_sheet' | 'collection_only'`.
- When `forceTerminalType` is provided, initialise `terminalType` state to that value and do not render the "On completion" section (Section 2).
- When editing an existing type (non-null `appointmentType` prop), read the terminal type from the existing data and do not render the "On completion" section either. The terminal type is locked once created.
- The "On completion" section is effectively removed from the UI entirely. The field still exists in the database and is still sent in the save payload, but it is no longer user-editable.
- Verify that removing this section doesn't break the save flow. The `terminalType` state variable is still set (from prop or existing data) and still included in the POST to `/api/appointment-types/configure`. Nothing downstream should break.

### 6. Post-appointment tab placeholder

When the Post-appointment tab is active, render a centred placeholder instead of the existing sidebar + middle pane:

- Centered vertically and horizontally in the content area.
- Muted text: "Post-appointment workflows coming soon."
- Style: text-sm text-gray-400.

**Important**: This replaces the existing post-appointment editor (sidebar + middle pane + `WorkflowMiddlePane` + `MidFlightWarningModal`). The existing post-appointment code can stay in the codebase but should not render. The simplest approach: keep the conditional rendering in `workflows-shell.tsx` but replace `{!isPre && (...)}` with the placeholder. Do not delete the existing post-appointment code since a follow-up spec will reactivate it.

### 7. Visual system check

- Inter font throughout (no JetBrains Mono on this page).
- Sentence case on all headings, buttons, and labels. Verify the existing codebase uses sentence case. The page header is "Workflows" (correct). Tab labels are "Pre-appointment" and "Post-appointment" (correct).
- Teal primary `#2ABFBF` for the "+ New appointment type" button.
- Modality pills: teal-50 bg with teal-800 text for Telehealth, gray-50 with gray-800 text for In-person. Verify the existing `Badge` component uses these exact colours.
- Amber "in flight" text: `#BA7517`, font-medium (weight 500). Do not use Tailwind's amber-600 or amber-700. Use an inline style or a custom class to hit the exact hex.
- Card containers: gray-200 border (0.5px if the design system uses that, otherwise 1px), rounded-xl (12px radius).

## Out of scope

- Post-appointment tab beyond the placeholder.
- Appointment type editor internals beyond removing the terminal type toggle and accepting `forceTerminalType`.
- Standalone collection editor (creating one opens the same appointment type editor with forced collection_only terminal type).
- Any changes to the workflow engine, schema, or API endpoints.
- Any changes to how runs are surfaced or tracked.

## Review checklist

When done:
1. Show the Pre-appointment tab with the explainer banner, appointment types table (run_sheet only), standalone collections section, and both creation buttons.
2. Walk through any decisions made where the spec was ambiguous.
3. Flag anything in the existing codebase that made this refactor awkward so we can clean it up properly.
