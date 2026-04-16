# TODO

## Demo — Thursday with Helene

### Must-have (blocks the demo narrative)

- [ ] **LiveKit video calls** — Clinician "Start call" button on run sheet, patient joins from waiting room. Needs: LiveKit client init, token generation endpoint, video room component with controls (mute, camera, end call), clinician-side and patient-side views. Currently: empty stubs in `src/lib/livekit/`.

- [ ] **QR code in-person check-in flow** — Patient scans QR at the location, verifies phone, gets matched to their scheduled appointment, session activates as `checked_in`. Currently: token resolution works but no appointment matching after OTP — it creates an on-demand session instead of matching to the existing one.

- [ ] **Form completion sidebar on readiness** — Click a completed form on the readiness dashboard, slide-out shows rendered form responses (field label + patient's answer), big copy buttons per field, "Copy all" bulk button, "Mark as transcribed" to resolve. Currently: `form-handoff-panel.tsx` exists with copy buttons but the API endpoint returns empty data — needs to actually fetch from `form_submissions.responses` JSONB and render the fields.

### Should-have (makes the demo polished)

- [ ] **Post-appointment readiness end-to-end** — Process a session with a pathway, see the task appear on the post-appointment readiness tab, resolve it. Verify the daily scan cron picks up post-appointment actions.

- [ ] **Pre-appointment intake journey end-to-end** — Add a patient on readiness, workflow fires, patient clicks the SMS link (console), completes intake (card + forms), readiness updates to "completed". Verify the intake package journey works start to finish.

- [ ] **Waiting room polish** — Show "running late" status updates, clinician name, proper transition animations when admitted. Currently: basic states work but video placeholder shows when `in_session`.

### Should-have (cont.)

- [ ] **Run sheet "end call" button** — Wire up a button on `in_session` rows that calls `markSessionComplete()` to transition `in_session` → `complete`. The action already exists in `src/lib/runsheet/actions.ts` — just needs a UI trigger on the session row so the receptionist/clinician can end the call and begin the Process flow.

### Nice-to-have (if time permits)

- [ ] **Team management settings** — `src/app/(clinic)/settings/team/page.tsx` is an empty stub. For demo: read-only table of seeded staff with roles is enough.

- [ ] **Payment processing visuals** — Stripe charge is stubbed (console log). For demo: show a success animation/confirmation even though no real charge happens.

- [ ] **Forms & Files tab + file delivery action** — Rename Forms nav item to "Forms & Files." Add a Files tab alongside existing forms list. Practice managers upload PDFs (e.g. "ADHD Fact Sheet") stored in Supabase Storage. The existing `send_file` action type (already in the enum, currently stubbed) delivers a file to the patient via SMS link. Pathway editor gets a "Send file" option in the action picker. Spec the patient-facing file viewer page separately.

### Not needed for demo

- SMS delivery (console log is fine)
- PMS sync
- Stripe real charges
- Team CRUD (read-only is enough)
- Conditional workflow chaining

---

## Backlog

### Add Session Panel: Patient Search

The add session panel currently takes a phone number only. When a phone number matches multiple patient contacts in the org, we auto-link the first match — which may be wrong.

**Plan:** Add a combo search (name + phone) to the add session panel. The receptionist types a name or phone, gets a filtered list of existing contacts, and selects one. This makes the patient link explicit at scheduling time, removing ambiguity for shared phone numbers (e.g. parent with two children).

When this lands:
- The panel passes `patient_id` directly to `createSessions`, skipping the phone-number-based auto-link
- The identity confirmation step in the patient entry flow can skip or pre-confirm since we already know who's scheduled
- Multi-contact resolution only falls back to the patient-side picker for on-demand entries (no pre-existing appointment)
