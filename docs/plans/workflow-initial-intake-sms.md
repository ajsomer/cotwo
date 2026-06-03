# Configurable initial intake SMS (Workflow Builder)

## Why
The patient pane Workflows section shows "what was sent" to the patient. For the
text to be honest, it must be configurable. Today only the **reminder** SMS are
configurable (intake_reminder blocks, up to 2 — already built). The **initial
intake package SMS** is hardcoded in `handleIntakePackage` and has no builder
field. This adds that one field end-to-end.

Decisions (confirmed):
- Keep the existing block model (intake_package + up to 2 intake_reminder).
- Initial SMS configured on the **intake_package** block.
- Pane shows the **configured template** with placeholders raw (no engine
  persistence of the interpolated body).
- "Up to 2 reminders" is already enforced (UI + API) — no change.

## The gap
`configure_appointment_type` RPC builds the intake_package block config as
`{ includes_card_capture, includes_consent, form_ids }` — no message field. So
even if the UI sent one, it wouldn't persist.

## Changes

### 1. Migration — extend the RPC (REQUIRED; no table change) — DONE
`src/lib/db/migrations/0001_configure_appointment_type_initial_message.sql`
(DB is **Neon**, project `cotwo`/royal-voice-41077434, not Supabase. The
`supabase/migrations` folder is historical record only. PL/pgSQL functions are
NOT managed by drizzle-kit generate/pull — only table schema is — so this is a
hand-authored SQL migration.)
- Adds `p_initial_message TEXT DEFAULT NULL`, appended LAST to preserve the
  positional arg order the configure route relies on.
- Adds `'message_body', p_initial_message` to the intake_package block config
  in both the UPDATE and INSERT paths.
- NOTE: appending a param creates a NEW Postgres function signature (functions
  are keyed by name + arg types). So the migration `DROP FUNCTION IF EXISTS` the
  prior 13-arg overload first, then CREATE OR REPLACE the 14-arg version — else
  the route's positional call could resolve to the stale 13-arg function.
- Applied to Neon main; verified end-to-end on a temporary branch (configured
  initial SMS persists to the intake_package block config). No table change.

### 2. Configure API — pass the new field
`src/app/api/appointment-types/configure/route.ts`
- Destructure `initial_message` from the body.
- Add it as the final positional arg in the `configure_appointment_type(...)`
  call (`${initial_message ?? null}::text`).
- Optional: length cap validation (mirror reminders' 160 hint; not enforced for
  reminders today, so keep symmetric — soft).

### 3. Builder UI — the field
`src/components/clinic/settings/appointment-type-editor.tsx`
- Read existing value: `existingIntakeConfig.message_body`.
- New state `initialMessage` seeded from it (fallback to a sensible default
  matching the current handler body, with correct placeholders).
- Add a Message textarea in **Section 3 (Intake package)** — mirror the reminder
  textarea (placeholder hints `{patient_first_name}`, `{link}`, `{clinic_name}`,
  char count). Place near the "patient will complete N items" line; update the
  line at :479 ("only receive the initial intake package SMS") to make sense
  alongside an editable field.
- Include `initial_message: initialMessage` in the `handleSave` POST body.

### 4. Handler — send the configured text
`src/lib/workflows/handlers.ts` (`handleIntakePackage`, ~line 252)
- Mirror `handleIntakeReminder`: read `ctx.config.message_body`; if set,
  interpolate `{patient_first_name}` / `{link}` / `{clinic_name}`; else fall
  back to the current hardcoded body. (The block config flows to `ctx.config`.)

### 5. Pane display — fix template source (correctness, ties off prior round)
`src/lib/workflows/types.ts` (`getMessageTemplate`)
- REMOVE the hardcoded mirror strings with wrong placeholder names
  (`{first_name}` etc.). Pull the template ONLY from config
  (`message_body` / `message`). intake_package now carries `message_body`, so
  its dropdown shows the configured text.
- For genuinely fixed messages with no config (e.g. capture_card, deliver_form),
  per the "show fixed body read-only" decision: return the handler's real body
  with the CORRECT placeholder names, labelled not-customisable in the UI. Keep
  these in a small map with a comment pointing at handlers.ts to reduce drift —
  OR (cleaner) return null and show no dropdown for those. RECOMMEND: null for
  fixed types, dropdown only where text is configurable. (Confirm.)

### 6. Builder meta
`src/lib/workflows/types.ts` — leave `intake_package.hasMessage` as-is; the
field is added directly in appointment-type-editor (the real intake authoring
surface), not via the generic action-card. (Flipping hasMessage would surface a
`config.message` textarea in the generic card under a DIFFERENT key — avoid the
key mismatch.)

## Verification
- Builder: edit an appointment type → Intake package → set initial SMS → save.
  Reopen: text persists.
- DB: the intake_package block's config now contains `message_body`.
- Fire the workflow (or inspect handler path): patient receives the configured
  text with placeholders filled.
- Pane: the intake_package message row's dropdown shows the configured template
  (placeholders raw).
- Existing appointment types with no initial_message still send the fallback.

## Risk / call-outs
- **Migration redefines a live RPC.** Appending the param keeps positional
  compatibility; the configure route is the only caller. Verify no other caller.
- One open choice in step 5 (fixed messages: read-only body vs no dropdown).
