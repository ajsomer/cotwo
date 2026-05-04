# Roadmap

What's in flight and what's planned next, ordered roughly by priority. One line per item, with a link to the relevant `docs/plans/` file when there is one.

This is forward-looking. For "what's been built so far," see `changelog.md`. The gap between this doc and the changelog is what's currently in flight.

This doc explicitly excludes long-horizon strategy and Layer 1-5 documents; those live elsewhere. Roadmap entries here are concrete pieces of work the build is committed to.

Update this doc when scope changes. If a roadmap item ships, move it to the changelog.

---

## In flight

Items that are actively being worked on or planned for the very next sprint.

- *(Empty at the time of writing this doc. Add in-flight items here as they are picked up.)*

## Next up

Items planned but not yet started. Roughly in the order we expect to tackle them.

- **Outstanding intake arrival gate hardening.** The gate ships in its current form; remaining work is a soft mode for clinician override (see `docs/plans/outstanding-intake-arrival-gate.md` "Override seam" section).
- **PMS integration: real Cliniko adapter.** Replace the prototype stub with a working Cliniko OAuth and API integration. Major engineering work; lands at the prototype-to-production transition.
- **Outcome pathway editing UI.** Practice Managers configure outcome pathways per appointment type, but the UI is incomplete. Filling out the editor and validating that the post-appointment workflow scheduling fires correctly.
- **Process flow polish.** The receptionist's process flow is functional but rough on edge cases (refunds, partial payments, skipped payment). Tighten the UX and edge case handling.
- **Patient presence heartbeat.** Detect "patient closed their browser" without polling, used for waiting-room dropoff detection. See `docs/plans/patient-presence-heartbeat.md`.
- **Run sheet visual refinements.** Density, type, and spacing improvements. See `docs/plans/runsheet-visual-refinements.md`.
- **Forms shipping checklist.** The forms feature works but a few QoL gaps remain (resend SMS UX, view submission rendering). Tracked separately.

## Later

Items committed to but not actively planned. Will be picked up when the items above clear.

- **Workflows tabbed restructure.** Cleaner navigation in the workflow template editor. See `docs/plans/workflows-tabbed-restructure.md`.
- **AI scribe routing.** A workflow action type that routes audio from a completed visit to a transcription service. Architecture sketched, no implementation yet.
- **Group sessions.** The schema supports multi-participant sessions (`session_participants`), but the UI assumes one participant. Expanding for group therapy use cases.
- **Cliniko-specific PMS feature parity.** Beyond the basic adapter: webhook handling, live status sync, payment reconciliation specifics.
- **Additional PMS adapters.** Halaxy, Power Diary, Nookal. Adapter-pattern based.

## Not committed

Items discussed but explicitly deferred or deprioritised. Listed so contributors know what's been considered and dropped.

- **Patient-facing accounts.** Considered and rejected. See `reference-decisions.md`.
- **Per-location branding overrides.** Discussed; deferred to post-MVP.
- **Coviu-side refunds UI.** Refunds happen in the Stripe dashboard with webhook write-back. A custom UI is not on the MVP path.
- **Multi-tenant admin tools.** No internal "support views" for Coviu staff to inspect clinic accounts. Out of scope for MVP.
- **Exporting form submissions to PDF.** The PMS owns the long-term record; PDF export from Coviu is a workaround for a problem the PMS integration solves directly.

## Engineering handoff workstreams

Distinct from feature work; these are the things the production team picks up when the prototype hands off. Listed here for visibility but not in the regular priority order; they happen in parallel with the prototype build wrapping up.

1. SMS provider integration (replace the console-log stub).
2. Video platform swap (LiveKit → Coviu's proprietary platform).
3. Stripe live mode (config swap; no code changes).
4. Email confirmation re-enabled (Supabase configuration).
5. Real Cliniko PMS integration (the major workstream).
6. Deployment target decision and setup.
7. Background job runner (move workflow scheduling out of the Next.js process if needed for reliability).
8. Comprehensive test suite (the prototype has type checking and lint; production needs more).
9. Service-role audit and monitoring.
10. Drop the vestigial `form_fields` table.

See `conventions-prototype-vs-production.md` for the full handoff inventory.

---

## How to use this doc

If you're picking up a piece of work, check whether it's listed in "Next up" or "Later." If it's not listed at all, that's a flag: either the item should be added before being worked on, or it's actually in scope of an existing item that wasn't recognised as such.

If a roadmap item is ambiguous (vague description, no plan file), open a plan file in `docs/plans/` before starting implementation. The plan file is the venue for working through scope and design; the roadmap entry is just a pointer.

When an item ships, add an entry to `changelog.md` with the date and a one-line summary, and remove it from this doc.
