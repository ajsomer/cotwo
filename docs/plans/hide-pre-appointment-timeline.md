# Plan: Hide the pre-appointment step timeline

## Problem

When a pre-appointment intake workflow is bundled into one package, the
expanded timeline shows every individual step:

```
Intake reminder    in 2d    Dropped
Intake reminder    in 4d    Dropped
Intake package     44m ago  Completed
Add to run sheet   in 11m   Sent
```

Two issues:

1. **The step-by-step timeline is noise for pre-appointment work.** Everything
   the user needs is already in the row's top-level status — pending / completed
   / late. The individual reminders (some `dropped` because they were scheduled
   past the appointment and never fired) add nothing.
2. **Redundant status.** A row grouped under the **"Form Completed"** priority
   slot also shows a **"Completed"** badge on its `intake_package` line. The
   grouping and the line badge say the same thing.

Hiding the pre-appointment timeline resolves both — the duplicate badge
disappears with the timeline that carried it.

## Scope (confirmed)

**Pre-appointment only.** The post-appointment timeline (PROMs, rebooking
nudges, resources, outcome-pathway steps) carries real information not captured
by a single status badge, and stays untouched.

## Key discriminator

Each `WorkflowAction` already carries `session_id`
(`src/stores/clinic/types.ts`). The fetchers set it from the row:

- `session_id === null` → **pre-appointment** action (scheduled relative to the
  appointment; the readiness lifecycle owns it).
- `session_id !== null` → **post-appointment** action (spawned from a session).

Both `src/lib/clinic/fetchers/workflow-actions.ts:139` and
`src/lib/clinic/fetchers/readiness.ts:356` compute `isPostAppointment =
!!action.session_id` already. So the UI can split pre/post purely on
`action.session_id` — **no data-layer or fetcher change required.**

## Affected surfaces

The expanded step timeline renders in two places:

| File | Component | What it shows | Action |
|------|-----------|---------------|--------|
| `src/components/clinic/readiness/patient-row.tsx` (lines 178–288) | Inline expanded timeline on a readiness row | Pre-appointment only (readiness is pre-appointment by definition) | Drop the timeline |
| `src/components/clinic/patient/patient-contact-card/forms-section.tsx` (lines 21–96) | `WorkflowTimeline` | Pre **and** post (readiness mode = pre; run-sheet mode can include post) | Filter to post-only |

`CompletedFormsList` (same file, lines 105–168) and the `PRIORITY_SLOTS`
header (`src/components/clinic/readiness/types.ts:56`) are **not changed** —
the "Completed forms" list (clickable, links to the submission PDF) and the
priority grouping both stay; only the redundant step timeline goes.

## Changes

### 1. Readiness dashboard — `patient-row.tsx`

The entire expanded section is the pre-appointment timeline, so remove it
**and** the expansion plumbing it required (decision confirmed: full cleanup).

- Delete the expanded-timeline block (lines **178–288**): the
  `{isExpanded && displayedActions.length > 0 && (...)}` JSX, including the
  `isPostDemoComplete` / `isActionOverdue` derivations and the
  "Show all steps" / "Show only relevant" toggle.
- Delete the expand/collapse **chevron** (lines 149–174).
- Delete the row-level click-to-expand: the `onClick={() => onToggle()}` and
  `cursor-pointer` on the row container (lines 67–70). The row is no longer
  expandable; the name button (`onNameClick`) and action `Button` remain the
  only interactive elements.
- Remove now-dead local state / derivations:
  - `showAll` `useState` (line 54).
  - `triggeringActions` / `useFiltered` / `displayedActions` (lines 48–58).
- Remove the `isExpanded`, `isAutoExpanded`, and `onToggle` props from
  `PatientRowProps` and the destructure (lines 22–45).
- Remove now-unused imports: `useState`, `ActionTypeIcon`,
  `ACTION_STATUS_BADGE`, `relativeTime`, `getTriggeringActions`, and the
  `ActionType` type — verify each after the cut.
- Keep: the row, the priority status `Badge` (lines 117–129), the action
  `Button` (lines 131–147), `onNameClick`, `onAction`, `onActionIntent`.
- Leave the lib function `getTriggeringActions` in
  `src/lib/readiness/derived-state.ts` in place (exported; just no longer
  called here) — removing it is out of scope unless it has no other callers.

### 1b. Readiness table — `readiness-table.tsx` (caller cleanup)

The row-expansion state here is self-contained and becomes dead once the
timeline is gone. **The slot-group collapse (`collapsedSlots` / `toggleSlot`)
is separate and stays** — that drives the "Form Completed" section header.

- Delete `expandedIds` and `manuallyCollapsed` `useState` (lines 43–46).
- Delete the `toggleRow` callback (lines 65–84).
- In the `items.map(...)` body (lines 180–205): delete the
  `isManuallyExpanded` / `isAutoExpanded` / `isRowExpanded` derivations
  (lines 181–187) and stop passing `isExpanded` / `isAutoExpanded` /
  `onToggle` to `<PatientRow>` (lines 195–197).
- Remove the now-unused `isAttentionPriority` import (line 11) — confirm it's
  not used elsewhere in the file first.
- Keep: `collapsedSlots`, `toggleSlot`, `slotGroups`, `useMemo`, `useCallback`,
  and everything driving the slot headers.

> `readiness-shell.tsx` does not own row-expansion state (verified the state
> lives in `readiness-table.tsx`), so no change there — but re-confirm during
> execution.

### 2. Patient contact card — `forms-section.tsx`

`WorkflowTimeline` must keep post-appointment steps but drop pre-appointment
ones. Filter at the top of the component:

```tsx
export function WorkflowTimeline({ actions }: WorkflowTimelineProps) {
  // Pre-appointment steps (session_id === null) are noise — the row's status
  // badge already conveys pending/completed/late. Show post-appointment steps
  // only (PROMs, rebooking, outcome-pathway actions), which a single status
  // can't summarise.
  const postActions = actions.filter((a) => a.session_id);

  const sortedActions = [...postActions].sort(
    (a, b) => b.offset_minutes - a.offset_minutes
  );

  if (sortedActions.length === 0) return null;
  // ...unchanged render
}
```

- `if (sortedActions.length === 0) return null` already exists, so when an
  appointment has only pre-appointment actions the whole section (and its
  divider in `index.tsx:388–393`) disappears cleanly.
- Rename the section `<h4>` (line 32) from **"Workflow"** to **"Follow-up"**
  (decision confirmed) — the section is now post-appointment only.
- No change to `CompletedFormsList`, `ACTION_STATUS_BADGE`, or `index.tsx`
  wiring; the empty-array guard handles the layout.

## What is explicitly NOT changing

- The `dropped` status, the scanner that produces it
  (`src/lib/workflows/scanner.ts`), or any data/migration. The actions still
  exist; we just stop rendering the pre-appointment ones.
- `PRIORITY_SLOTS` "Form Completed" header and all readiness grouping.
- The "Completed forms" PDF list.
- Post-appointment timeline behaviour anywhere.

## Verification

1. Readiness dashboard: a row with a completed intake package shows the
   "Form Completed" status and no expanded reminder/package/run-sheet steps.
   No leftover chevron or empty expansion area.
2. Patient contact card opened from a **readiness** row (pre-appointment only):
   the "Workflow" section is gone; "Completed forms" still lists the submission.
3. Patient contact card opened from a **run-sheet** row with post-appointment
   actions: the post-appointment timeline still renders.
4. `npm run lint` / typecheck clean — confirm no unused imports/vars remain in
   `patient-row.tsx` after the cut.

## Decisions (resolved)

- **Rename "Workflow" → "Follow-up"** in the contact card — yes (§2).
- **Remove expansion plumbing entirely** from `patient-row.tsx` and
  `readiness-table.tsx` — yes (§1, §1b). Slot-group collapse stays.
