# UX Spec: Appointment Types Configuration Surface

**Status**: Draft — revised
**Tier**: Complete only
**Date**: 2026-04-09
**Related spec**: Intake Package Workflow Engine (v2)

---

## Overview

The appointment types configuration surface is where practice managers set up what their clinic offers and what patients need to complete before each type of appointment. It lives in the admin area under **Settings → Appointment types**.

This surface has two views:

1. **List view** — a table of all appointment types with their current configuration state
2. **Editor slide-out** — opens from the right when a row is clicked (or "+ New appointment type" is pressed), contains the full configuration surface for a single appointment type

The editor is a slide-out, not a page navigation, to keep the practice manager in context and consistent with other slide-out patterns in the product (run sheet Process flow, Add sessions panel).

---

## Mental model

The practice manager thinks about this surface in terms of their clinic's actual operations:

> "These are the kinds of appointments we do. For each one, what do we need from the patient before they arrive, and how should we chase them if they haven't done it?"

The surface matches this. Each row in the list is a kind of appointment. Clicking into a row lets them configure intake. No timelines, no action blocks, no drag-and-drop. Just a form.

Post-appointment workflows (outcome pathways) are explicitly **not** part of this surface. They live in a separate sibling screen (**Settings → Outcome pathways**) because they're a shared library the receptionist picks from after a session, not a property of the appointment type itself.

---

## List view

### Purpose
A dense, scannable table showing every appointment type in the clinic with its configuration status at a glance. The primary entry point for configuration work.

### Header strip
- **Title**: "Appointment types"
- **Sub-title**: "Configure what your clinic offers and what patients need to complete beforehand."
- **Actions** (right-aligned):
  - `Sync from PMS` button (visible only when a PMS integration is connected). Icon: circular refresh arrows.
  - `+ New appointment type` button (teal primary).

### Unconfigured banner
If there are any appointment types with no intake package configured, show an amber banner strip directly below the header:

> ⚠ *N* appointment types need intake packages configured — [Show unconfigured]

Clicking "Show unconfigured" applies a filter to the table showing only those rows. Dismissible (× on the right).

### Filters strip
Thin strip with:
- Search input (left-aligned, max 280px, placeholder "Search appointment types")
- "All sources" dropdown (filters by PMS-synced vs manually created)
- "All statuses" dropdown (filters by configured vs not configured)
- "Show archived" toggle (default off, shows archived PMS-synced types when enabled)

### Table
Columns, from left to right:

| Column | Width | Content |
|---|---|---|
| **Name** | flex (2fr) | Appointment type name (14px/500), one-line description (12px muted), plus a small source icon (PMS sync icon for synced rows, nothing for manual) |
| **Duration** | 90px | e.g. "60 min". Em dash (—) for collection-only types |
| **Modality** | 100px | Pill: Telehealth (teal), In-person (purple), Both (grey). Em dash (—) for collection-only types |
| **Intake package** | flex (1.5fr) | Status dot + two-line summary (see below) |
| **On completion** | 100px right-aligned | Pill: "Run sheet" (grey) or "Collection" (amber) |

**Intake package column detail:**

Configured state:
- Line 1: "5 items · card, consent, 3 forms" (what's in the package)
- Line 2: "2 reminders · at-risk 4d, overdue 6d" (how we chase and when we flag)

Not configured state:
- Line 1: "Not configured"
- Line 2: "Set up intake package →" (amber action prompt)

**Row interaction**: entire row is clickable, opens the editor slide-out. Hover state: subtle background tint.

**Row states**:
- **Configured**: teal status dot, summary lines in primary text colour
- **Not configured**: grey status dot, "Not configured" in secondary text, amber action prompt
- **Currently open in editor**: subtle selected-state background (same as hover, slightly stronger)

**Source indicator**: small circular refresh icon next to the appointment type name for PMS-synced rows. No icon for manually created rows. The description line below the name includes ", From PMS" or ", Manually created" as muted text so the source is discoverable without dominating the layout.

### Footer
Small muted text centred: "*N* appointment types"

---

## Editor slide-out

### Container
- **Width**: 620px
- **Position**: pinned to the right edge, full height
- **Background behind slide-out**: list view dimmed to 40% opacity, pointer-events disabled (can't interact with list while editor is open)
- **Animation**: slides in from the right, dim overlay fades in simultaneously

### Header
Fixed at top of slide-out:

- **Left side**:
  - Appointment type name (16px/500). For new appointment types, this is an editable input with placeholder "Appointment type name" focused on open.
  - Source indicator: small PMS sync icon + "Synced from [PMS name]" in muted text, OR nothing if manually created
  - Meta line: "Last edited *N* days ago by [user]" in muted text. Hidden for new (never-saved) appointment types.
- **Right side**: close X icon (clickable)

### Body
Scrollable. Contains the five sections described below.

**Two default states**:

- **Unconfigured / new**: progress strip at the top, all sections expanded, working through top to bottom like a guided form
- **Configured**: no progress strip, all sections collapsed to summary rows, practice manager expands only what they want to edit

### Footer
Fixed at bottom of slide-out:

- **Left side**: "Delete appointment type" button — destructive styling (red text, transparent background, no border). For PMS-synced appointment types, this reads "Archive appointment type" instead.
- **Right side**: "Cancel" button (neutral) and primary action button
  - For new appointment types: "Create appointment type" (teal primary)
  - For existing configured appointment types: "Save changes" (teal primary)

---

## Progress strip (unconfigured state only)

A thin horizontal strip at the top of the editor body, above the first section. Visible only when the appointment type is unconfigured (new, or PMS-synced but never set up).

### Structure
Five circular step indicators connected by thin lines, with labels below each. Each step corresponds to one section:

1. Details
2. On completion
3. Intake package
4. Reminders
5. Urgency

### Behaviour
- **Empty step**: grey outlined circle, label in muted text
- **In-progress step** (user has scrolled to / interacted with this section but hasn't completed it): teal outlined circle
- **Complete step** (section's current state is valid — all required fields filled, or optional section with valid default): solid teal filled circle with a check mark
- **Connecting lines**: grey by default, teal between two complete steps

The progress strip is **informational, not interactive**. Clicking a step does not navigate to it — the editor is a scrolling form, not a stepper. The strip just gives the practice manager a sense of how far they've come and how much is left.

### Step completion logic

Each section is either valid (complete) or invalid (incomplete). This is a validity check, not an interaction check:

- **Details**: all required fields have values (name, and duration + modality if terminal type is run_sheet)
- **On completion**: a selection has been made (one of the two cards)
- **Intake package**: at least one item beyond the locked contact-creation row is enabled
- **Reminders**: always valid (optional section — zero reminders is a valid state)
- **Urgency**: always valid (optional section — no thresholds is a valid state)

### Disappearance
The progress strip disappears entirely after the first successful save. Subsequent visits to this appointment type show the collapsed-section configured state, with no progress strip.

---

## Section structure

Each section has two forms: **collapsed** and **expanded**.

### Collapsed (summary row)

A bordered row containing:

- Right-pointing chevron (left side, indicates the section is expandable)
- Section title (13px/500)
- Summary line (12px muted) showing the section's current state

Example collapsed rows:

- **Details** · 60 min telehealth · $220.00
- **On completion** · Run sheet appointment
- **Intake package** · 5 items · card on file, consent, 3 forms
- **Reminders** · 2 reminders at day 3 and day 5
- **Urgency** · At-risk 4 days · overdue 6 days

Empty/not-set summary lines:

- **Reminders** · No reminders configured
- **Urgency** · Using system defaults only

**Interaction**: clicking anywhere on the row expands it. Clicking again collapses. Multiple sections can be expanded simultaneously.

### Expanded

The bordered row's border thickens slightly (indicates active focus), the chevron rotates to point down, and the content area appears below the header with the full editing surface for that section. Other sections stay collapsed above and below.

### Unsaved changes indicator

If a section has unsaved changes, show a small amber dot on the right side of the collapsed row's header. When the practice manager collapses a modified section, the dot persists so they can see which sections are dirty. Clears on successful save.

### Validation error indicator

If a section has a validation error, show a small red dot on the right side of the collapsed row's header. Clicking the row expands it and scrolls to the erroring field.

---

## Section 1: Details

### Expanded content

Two-column grid for primary fields:

| Field | Type | Notes |
|---|---|---|
| Name | Text input | Locked for PMS-synced (greyed background, lock icon next to label). Editable for manually created. |
| Duration | Text input | Locked for PMS-synced. Editable for manually created. Muted with helper text "Not applicable for collection-only appointment types" when On completion = Collection only; value ignored. |
| Modality | Dropdown | Always editable. Options: Telehealth, In-person, Both. Muted with helper text "Not applicable for collection-only appointment types" when On completion = Collection only; value ignored. |
| Default fee | Currency input (AUD, hardcoded for prototype) | Always editable, even for PMS-synced (the PMS doesn't reliably expose fees) |

**PMS note box** (shown only when the appointment type is PMS-synced): small muted text block at the bottom of the Details section:

> Name and duration are synced from [PMS name]. Edit in [PMS name] and click Sync to update.

### Summary line format

- Run sheet types: "{duration} {modality} · {fee}" — e.g. "60 min telehealth · $220.00"
- Collection-only types: "Collection only · {fee}" — e.g. "Collection only · $150.00"
- If any required field is missing: "Not set"

---

## Section 2: On completion

### Expanded content

Sub-header: "What happens when the intake package is complete?"

Two cards side by side, full width, clickable to select:

**Card 1: Run sheet appointment** (default)
- Icon: calendar with a clock
- Title: "Run sheet appointment"
- Description: "Ends in a telehealth or in-person session. Patient is added to the run sheet on the day."

**Card 2: Collection only**
- Icon: document with check mark
- Title: "Collection only"
- Description: "Collects information and terminates. No session, no run sheet row."

Selected card has a 2px teal border. Unselected card has a 0.5px neutral border.

Below the cards: a one-line explainer that changes based on selection.

- Run sheet selected: "Patients will be automatically added to the run sheet on their appointment day."
- Collection only selected: "This workflow completes when the patient finishes the intake package."

**Data flow note:** The selected value is persisted to the linked workflow template's `terminal_type` field (via `type_workflow_links`), not to the appointment type row directly. The UI abstracts the `appointment_types` → `type_workflow_links` → `workflow_templates` join away from the practice manager. Selecting "Run sheet appointment" automatically creates the hidden `add_to_runsheet` action block on the linked workflow template. Selecting "Collection only" removes it. The practice manager never sees or configures this action.

**Side effects on other sections:** Changing the terminal type to "Collection only" mutes the Duration and Modality fields in Section 1 (Details). Changing back to "Run sheet appointment" un-mutes them.

### Summary line format
"{selected card title}"

Examples:
- "Run sheet appointment"
- "Collection only"

---

## Section 3: Intake package

### Expanded content

Sub-header: "What should the patient complete before the appointment?"

A bordered container with a list of item rows:

**Row 1: Verify identity and create contact** (always first, locked)
- Small lock icon
- Title: "Verify identity and create contact"
- Description: "The patient verifies their phone number and a contact record is created. This saves their progress across reminders."
- Right side: "Required" pill (small, muted background)
- Background: subtle secondary tint to visually distinguish from configurable items

**Row 2: Store a card on file** (toggle, default off)
- Title: "Store a card on file"
- Description: "The patient stores a payment method so you can charge after the session."
- Right side: iOS-style toggle switch

**Row 3: Provide consent** (toggle, default off)
- Title: "Provide consent"
- Description: "The patient agrees to your clinic's terms before the appointment."
- Right side: iOS-style toggle switch

**Row 4: Fill out forms** (multi-select picker, not a toggle)
- Title: "Fill out forms"
- Description dynamic based on selection: "No forms selected" / "3 forms selected"
- Right side: "Add form" button (small, secondary)
- Below: stacked rows of selected forms, each with the form name and a × remove icon. Selected forms have a subtle secondary background and rounded corners.

**Add form behaviour**: clicking "Add form" expands an inline panel **directly below the button** (not a nested slide-out, not a modal) showing:
- Header: "Select forms from your library"
- Search input at the top of the list (client-side substring match, sufficient for v1)
- Scrollable list of all published forms in the clinic's form library, each with a checkbox
- Footer with "Done" button

When Done is clicked, the panel collapses and the selected forms appear in the list above. This is the only exception to the "no nested slide-outs" rule for the form picker — it's an inline expansion, not a second slide-out.

### Summary line at the bottom of expanded section
"The patient will complete *N* items in one journey."

### Collapsed summary line format
"{item count} items · {comma-separated list of enabled items, forms counted as 'N forms'}"

Examples:
- "5 items · card on file, consent, 3 forms"
- "2 items · consent, 1 form"
- "1 item · contact creation only" (when nothing else is toggled on)

---

## Section 4: Reminders

### Expanded content

Sub-header: "Send up to 2 reminders if the patient hasn't completed their intake package."

A stack of reminder cards. Each card has:

- **Header**: "Reminder 1" or "Reminder 2" title, trash icon on the right for deletion
- **Timing**: inline row reading "Send [number input] days after the intake package is sent"
- **Message textarea**: labelled "Message", pre-populated with a default message using template variables
- **Below textarea**: two small muted lines — available variables on the left ("{patient_first_name}, {appointment_date}, {link}"), character count on the right ("*N* / 160")

Default message: `Hi {patient_first_name}, just a reminder to complete your intake for your upcoming appointment. Tap here to continue: {link}`

**Add reminder button**: sits below the last reminder card. Full width, secondary style. Disabled with muted text "Add reminder (maximum reached)" when two reminders exist.

**Empty state**: if no reminders are configured, the section shows a centred message: "No reminders configured. The patient will only receive the initial intake package SMS." Plus a prominent "Add reminder" button.

### Validation
- Reminder offsets must be unique (cannot have two reminders on day 3)
- Reminder offsets must be positive integers

### Collapsed summary line format
- No reminders: "No reminders configured"
- One reminder: "1 reminder at day {offset}"
- Two reminders: "2 reminders at day {offset1} and day {offset2}"

---

## Section 5: Dashboard urgency

### Expanded content

Sub-header: "When should an incomplete package be flagged on your readiness dashboard?"

Two inline numeric rows:

- 🟠 **Mark as at-risk** [number input] days after sent, if still incomplete
- 🔴 **Mark as overdue** [number input] days after sent, if still incomplete

Both fields can be left blank.

**Fallback note box** (info-style, blue background, info icon):

> For run-sheet appointments, Coviu will always mark the package as at-risk 2 days before the appointment and overdue 1 day before, regardless of the thresholds above. This guarantees short-lead bookings are surfaced appropriately.

### Validation
- If both fields are set, `overdue_after_days` must be greater than `at_risk_after_days`
- Must be positive integers when set

### Collapsed summary line format
- Both set: "At-risk {N} days · overdue {N} days"
- Only at-risk set: "At-risk {N} days · no overdue threshold"
- Only overdue set: "Overdue {N} days · no at-risk threshold"
- Neither set: "Using system defaults only"

---

## Default expand/collapse states

Behaviour on editor open, by appointment type state:

| State | Progress strip? | Sections default |
|---|---|---|
| New (manually created, just opened) | Yes | All expanded |
| PMS-synced, never configured | Yes | All expanded |
| Configured (all sections have content) | No | All collapsed |
| Configured but with validation errors | No | Sections with errors expanded, others collapsed |

**After a save**: the progress strip (if present) disappears. If the practice manager saves and re-opens the same appointment type, they see the collapsed state.

**Multiple sections open at once**: allowed and expected. Opening one section does not close others.

---

## Save / cancel behaviour

### Save flow
1. Practice manager clicks "Save changes" (or "Create appointment type" for new)
2. Validation runs. Any sections with errors auto-expand and show red dots on their headers
3. If valid: data is persisted atomically (see "Save transaction semantics" below), slide-out closes automatically, list view un-dims, and a toast notification appears briefly at the top of the list view: "[Appointment type name] saved"
4. The saved row in the list view briefly highlights (subtle teal background flash, 1 second) to confirm the save landed on the right row

### Cancel / close with unsaved changes
1. Practice manager clicks Cancel or the X close icon
2. If any section has unsaved changes, show a confirmation inside the slide-out (not a modal): an inline banner at the bottom of the slide-out body above the footer, amber background:

> You have unsaved changes. [Discard and close] [Keep editing]

3. Clicking "Discard and close" closes without saving. Clicking "Keep editing" dismisses the banner and returns focus to the editor.

### Delete flow
1. Practice manager clicks "Delete appointment type" (or "Archive" for PMS-synced)
2. Confirmation inline banner replaces the footer temporarily:

> Delete this appointment type? This cannot be undone. [Delete] [Cancel]

3. For PMS-synced types, the language is softer:

> Archive this appointment type? It will be hidden from the list but can be restored from your archive. [Archive] [Cancel]

4. On confirmation, slide-out closes and list refreshes.

---

## Save transaction semantics

The save operation is a **single API call** from the client that persists the full appointment type configuration atomically. The client sends one payload; the server handles the multi-table write in a single database transaction.

### Write order

All writes execute within a single transaction, in this deterministic order:

1. **`appointment_types` row** — create or update (name, duration, modality, default_fee_cents)
2. **`workflow_templates` row** — create or update (terminal_type, at_risk_after_days, overdue_after_days)
3. **`type_workflow_links` row** — create if it doesn't exist (links appointment type to workflow template, direction = pre_appointment)
4. **`intake_package` action block** — create or update (config JSON: form_ids, includes_card_capture, includes_consent)
5. **`intake_reminder` action blocks** — create new reminders, update existing reminders (offset_days, message_body), delete removed reminders. Child blocks reference the intake_package block via `parent_action_block_id`.
6. **`add_to_runsheet` action block** — if terminal_type is `run_sheet`, ensure exactly one exists (create if missing). If terminal_type is `collection_only`, delete if present.

### Failure handling

If any write in the transaction fails, the entire transaction rolls back. No partial state, no half-updated templates. The client receives a single error response and shows: "Couldn't save. Please try again."

### Idempotency

The save endpoint is idempotent at the appointment-type-id level. Double-clicks and retries produce the same result. The endpoint uses upsert semantics where possible.

### Create vs update unification

The save endpoint handles both "create from scratch" (new appointment type, no existing workflow template or links) and "update existing" in the same call. PMS-synced appointment types that have never been configured fall into the create case for the workflow-related rows. The client does not need to know which case it's in — it sends the full configuration payload either way.

### Template edit immutability

Per the intake package workflow engine spec: saving changes to an appointment type's configuration does **not** retroactively mutate in-flight workflow runs. Existing runs keep their original actions. Only newly instantiated workflows pick up the updated template. This is handled at the workflow engine level, not the save endpoint — the save endpoint only writes the template; the engine snapshots it at instantiation time.

---

## PMS sync behaviour

### Initial sync
When the PMS integration is first connected (during Complete tier onboarding), Coviu automatically runs an initial sync that:
- Fetches all appointment types from the PMS
- Creates an `appointment_types` row for each one in Coviu
- Marks them as not-configured
- Shows the unconfigured banner in the list view, guiding the practice manager to set them up

### Manual sync
After the initial sync, practice managers click "Sync from PMS" in the list view header to pull updates. The button:
- Fetches current appointment types from the PMS
- Adds any new ones as not-configured rows
- Updates name and duration for existing synced rows (silently, no confirmation)
- Does not touch intake package, default fee, or any Coviu-side configuration
- Shows a toast on completion: "Synced *N* appointment types from [PMS name]" (or "No changes" if nothing updated)

### Orphaned rows
If an appointment type exists in Coviu (from a previous sync) but no longer exists in the PMS, it is **archived, not deleted**:
- Removed from the main list view (visible via "Show archived" filter)
- Its intake package configuration is preserved
- If the same appointment type reappears in a future sync, it is un-archived and reconnected

---

## Interaction consistency with other slide-outs

This editor follows the same slide-out pattern as the run sheet's Process flow and Add sessions panel:

| Aspect | Pattern |
|---|---|
| Width | 620px (wider than Process flow's 360px because this form is denser) |
| Dim | List view dims to 40% opacity |
| Close | X icon top-right, Escape key, or click outside (with unsaved changes confirmation if applicable) |
| Scrolling | Body scrolls vertically, header and footer pinned |
| Animation | Slide in from right, fade dim overlay simultaneously |

The only exception to the "no nested slide-outs" rule is the form picker inside the intake package section, which is an **inline expansion** rather than a second slide-out.

---

## Visual styling

All styling follows the existing Coviu design system from the run sheet spec:

- **Primary colour**: `#2ABFBF` (teal)
- **Accent**: `#D4882B` (amber) — used for at-risk states and unconfigured banners
- **Danger**: `#E24B4A` (red) — used for overdue states and destructive actions
- **Success**: `#1D9E75` (green) — used for the "configured" status dot
- **Text primary**: `#2C2C2A`
- **Text secondary**: `#8A8985`
- **Borders**: `#E2E1DE`
- **Backgrounds**: `#F8F8F6` (page), white (surfaces)
- **Font**: Inter for all UI text, JetBrains Mono for any times/numerics in the Details summary line
- **Border radius**: `var(--border-radius-md)` (8px) for most elements, `var(--border-radius-lg)` (12px) for the slide-out container and cards

---

## Out of scope

- **Bulk actions on the list view** (select multiple appointment types to delete or duplicate). V2.
- **Duplicate an appointment type** to create a new one from an existing configuration. V2.
- **Drag to reorder forms** within the intake package. V2. For v1, forms are displayed in the order they were added.
- **Reorder sections** in the editor. Fixed order.
- **Draft vs published states** for appointment types. Every save is live immediately.
- **Template library** of pre-built intake package templates the practice manager can start from. V2.
- **Import / export** of appointment type configurations across clinics. Not planned.
- **Preview for different lead times** in the editor. Removed from scope — practice managers can learn the behaviour from experience.
- **Default outcome pathway** field. Removed — the receptionist picks the pathway during the Process flow after each session.
- **Post-appointment workflows / outcome pathways** as part of this surface. Separate sibling screen (Settings → Outcome pathways), not covered by this spec.

---

## Resolved questions

1. **Archive UI for PMS-synced types**: "Show archived" toggle in the filters strip alongside the source and status filters. Not a separate screen.
2. **Form picker search**: client-side substring match for v1. Sufficient for clinics with up to 50+ forms. Flag for v2 if performance becomes an issue.
3. **Currency formatting**: hardcoded AUD for the prototype. All prototype clinics are Australian.
4. **Progress strip step completion logic**: every section is either valid (complete) or invalid (incomplete). A valid state means all required fields are filled (for required sections) or the section's current state is valid (for optional sections like Reminders and Urgency, where the default empty state is valid). The progress strip is a navigation aid, not a quality gate.
