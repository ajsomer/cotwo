# TODO

## Demo — Thursday with Helene

### Must-have (blocks the demo narrative)

- [ ] **LiveKit video calls** — Clinician "Start call" button on run sheet, patient joins from waiting room. Needs: LiveKit client init, token generation endpoint, video room component with controls (mute, camera, end call), clinician-side and patient-side views. Currently: empty stubs in `src/lib/livekit/`.

- [ ] **QR code in-person check-in flow** — Patient scans QR at the location, verifies phone, gets matched to their scheduled appointment, session activates as `checked_in`. Currently: token resolution works but no appointment matching after OTP — it creates an on-demand session instead of matching to the existing one.

- [ ] **Intake package Phase 7 — patient-facing journey page** — `src/app/intake/[token]/page.tsx` + layout + 3 API routes (`route.ts`, `verify/route.ts`, `complete-item/route.ts`) + 2 patient components (`intake-journey.tsx`, `intake-card-capture.tsx`). Fully specced in `docs/specs/intake-package-execution-plan.md` Phase 7. Without it, workflow-fired intake package SMS links land on 404. Prerequisite for the onboarding spec.

- [ ] **Refactor `seed-defaults.ts` to emit `intake_package` action blocks** — Currently still emits legacy `deliver_form` / `capture_card` / `send_reminder` / `verify_contact` action types (migration 014 added `intake_package` / `intake_reminder` / `add_to_runsheet` but the seeder was never updated). New orgs get workflows built on the old types, which work but don't produce intake package journeys. Onboarding demo needs the seeder to emit `intake_package` blocks so the test session fires through the Phase 7 flow.

- [ ] **Intake package Phase 8 — identity model refactor** — The intake journey currently attempts "Create patient contact" inside the journey. In reality the clinic asserts identity at add-patient time (first name, last name, phone, DOB). The journey should just verify phone ownership and confirm the existing contact. Small refactor: `handleIntakePackage` stops creating contacts, verify endpoint returns matched/multi/no-match shapes, journey screen becomes confirm-only, editor drops the locked "Create patient contact" checklist row, three specs get corrected. Fully specced in `docs/specs/intake-package-execution-plan.md` Phase 8. Prerequisite for onboarding.

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

### Testing hooks — remove before prod

- [ ] **Intake completion fires `add_to_runsheet` immediately** — `src/app/api/intake/[token]/complete-item/route.ts` calls `fireActionNow` on the `add_to_runsheet` action as soon as the patient finishes the package, bypassing the real scheduled offset. Lets us walk the end-to-end flow (intake → run sheet → waiting room) in one sitting. The API response also includes `session_join_url`, and the patient-facing components (`intake-journey.tsx`, `intake-card-capture.tsx`) log it to the browser console via `logJoinUrlIfPresent`. Rip out all three when a dedicated test fixture / time-travel tool lands. Marked with `TESTING ONLY` comments at each site. Also: `fireActionNow` in `src/lib/workflows/engine.ts` can stay (it's a legit primitive) but the call site in complete-item must go.

---

## Backlog

### Add Session Panel: Patient Search

The add session panel currently takes a phone number only. When a phone number matches multiple patient contacts in the org, we auto-link the first match — which may be wrong.

**Plan:** Add a combo search (name + phone) to the add session panel. The receptionist types a name or phone, gets a filtered list of existing contacts, and selects one. This makes the patient link explicit at scheduling time, removing ambiguity for shared phone numbers (e.g. parent with two children).

When this lands:
- The panel passes `patient_id` directly to `createSessions`, skipping the phone-number-based auto-link
- The identity confirmation step in the patient entry flow can skip or pre-confirm since we already know who's scheduled
- Multi-contact resolution only falls back to the patient-side picker for on-demand entries (no pre-existing appointment)

### Onboarding — Process button coach-mark (v2)

After the onboarding test call ends, the session transitions to `complete`. Add a coach-mark on the run sheet pointing at the Process button on the test session row. Walk the user through the existing Process flow (take payment → select outcome pathway → done) on their own test session so they see the post-appointment mechanics on the same session they just experienced as a patient.

Deliberately deferred from the v1 onboarding spec to keep the activation arc lean. The v1 arc ends when the test call ends — everything after that is optional reinforcement.

When this lands: extends `onboarding_stage` enum in `users` with a `process_completed` value; adds the coach-mark to the existing run sheet session row; no changes to the Process flow itself.

### Onboarding — mobile-only signup path (v2)

v1 assumes the user signs up on a laptop with their phone nearby — the activation arc depends on seeing both the run sheet and the patient flow simultaneously on two devices.

If a user signs up from mobile, that arc doesn't work. Options:

- Gate: detect mobile at step 5 and show "Open this on your laptop to send yourself a test session. Here's a link to resume."
- Single-device arc: split phone screens and laptop screens into tabbed views in the same browser. User flips between tabs to see both sides. Lossier than two-device, but possible.
- Accept that mobile onboarding ends at step 4 (payments done) and the user hits a real run sheet with no test session until they next log in from a laptop.

Decide before shipping mobile signup. For the v1 prototype demo (done on a laptop), this is not blocking.
