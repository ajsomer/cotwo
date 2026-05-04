# Changelog

Curated narrative log of significant changes. Append-only. One bullet per change, dated. Links to the relevant `docs/plans/` or `docs/devlogs/` file when one exists.

This is the human-readable history. Distinct from `git log` (which is the full record but not curated) and from `roadmap.md` (which is forward-looking). The gap between this doc and the roadmap is what's currently in flight.

Capped at the most recent ~50 entries; older items archive to `docs/archive/`. Most recent at the top.

---

## 2026-04-27

- **Sidebar label: "Readiness" renamed to "Tasks."** UI-only change; URL and code still use `readiness`. See `feature-readiness-dashboard.md`.
- **Outstanding intake arrival gate.** Patients with an unfinished intake package for an upcoming appointment are blocked from reaching the waiting room until they complete it. Embedded inside the entry flow via a new `<EmbeddedIntakeJourney>` wrapper. See `docs/plans/outstanding-intake-arrival-gate.md`.
- **Run sheet `waiting` state Admit button** now applies regardless of modality (cleanup; `waiting` was always telehealth-only, so the modality branch was dead code).

## 2026-04-22

- **Intake package transcription handoff and live readiness.** Receptionists see completed intake packages on the readiness dashboard with a "needs transcription" priority, open a handoff panel showing all submitted data, and mark the package transcribed once it's in the PMS. Live Socket.io updates so other open dashboards reflect the change. See `docs/plans/intake-package-transcription-handoff.md` and `docs/plans/readiness-live-updates-socketio.md`.

## 2026-04-20

- **Immediately-due workflow actions fire at schedule time.** Actions whose `scheduled_for` is in the past (e.g. add-patient on the day of the appointment) fire synchronously during scheduling and return their result to the client.
- **Intake package Phase 8: confirm-mode identity.** The intake journey verifies phone ownership against the appointment's already-asserted patient_id rather than capturing identity afresh.
- **Seed-defaults emit intake_package action blocks** for new orgs.
- **Intake package Phase 7: patient-facing journey UI.** The bundled-package patient experience shipped: phone OTP, identity confirmation, checklist, per-item phases, completion screen.

## 2026-04-16

- **Socket.io live updates + fetch-once Zustand cache.** The clinic-side architecture for real-time updates landed: location-scoped Socket.io channels, optimistic update pattern, polling fallback, Zustand store as the single source of truth.
- **LiveKit video calls: clinician panel, patient auto-join, Hold/Rejoin.** Telehealth video flow end to end.
- **Files library** for org-scoped PDF uploads, workflow delivery, and patient viewer.
- **Post-appointment workflows landed.** Schema, engine, process flow integration, outcome pathways editor, readiness dashboard inclusion.

## 2026-04-14

- **Workflows page restructure.** Tabbed pre/post layout, split tables, visual polish. See `docs/plans/workflows-tabbed-restructure.md`.

## 2026-04-10

- **Intake package workflow engine.** Schema, action handlers, template editor, readiness dashboard inclusion. The bundled-package architecture replacing per-form `deliver_form` actions.

## 2026-04-08

- **Instant sidebar navigation.** Zustand store, Realtime subscriptions, middleware cache. Nav between `/runsheet`, `/readiness`, `/workflows`, `/forms`, `/settings` is now instant. See `docs/plans/nav-perf-plan.md` (in repo memory) for the design.

## Earlier than 2026-04-07

For changes earlier than the entries above, see `git log --before=2026-04-07` in the repo. The changelog starts at the navigation-performance work because that's where the architecture stabilised; before then, the codebase was iterating quickly enough that a curated log would have been mostly noise.

---

## How to add an entry

1. The change has shipped (merged to main).
2. The change is significant enough to be worth flagging to a future contributor reading the project. Bug fixes that don't change behaviour don't need an entry; behaviour changes, new features, and architectural shifts do.
3. Add the entry under the most recent date heading (or create a new date heading at the top if it's a new day's first entry).
4. One sentence on what changed and a one-clause "why" if the why isn't obvious.
5. Link to `docs/plans/` or `docs/devlogs/` if one exists.

If you're tempted to write a multi-paragraph entry, the plan file is the right home for the detail; the changelog entry should still be one line.
