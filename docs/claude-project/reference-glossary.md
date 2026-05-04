# Reference: Glossary

Every Coviu-specific term with a one-line definition. Designed for "I keep seeing this word and don't know what it means." Alphabetical.

If a term is missing, add it. If a term you're using doesn't appear here, double-check whether it's actually a Coviu-specific term or a generic one (don't add "patient" to this glossary).

---

**Action block.** A single configured step inside a workflow template. Carries `action_type`, `offset_minutes`, `modality_filter`, and `config`. See `feature-workflow-engine.md`.

**Action handler.** The function that executes a particular `action_type` at fire time. Lives in `src/lib/workflows/handlers.ts`. Each action type has one handler.

**Add patient (flow).** The receptionist's slide-over panel from the readiness dashboard for adding a patient with an upcoming appointment. Different from the run sheet's "+ Add session," which is location-and-time only with no patient details.

**Add to runsheet.** The `add_to_runsheet` workflow action type. Fires at appointment time and marks the appointment as ready for session-spawn during the morning scan.

**Adapter (PMS).** The interface that abstracts a specific PMS API (Cliniko, Halaxy, etc.) behind a common shape. See `feature-pms-integration.md`.

**Admit.** The clinician action that flips a session from `waiting` to `in_session` and starts the telehealth call. Visible on the run sheet.

**Appointment.** The planning entity. Created days, weeks, or months in advance. Carries `patient_id`, `clinician_id`, `appointment_type_id`, `room_id`, `scheduled_at`. See `01-core-concepts.md`.

**Appointment action.** A runtime instance of a workflow action block, tied to a specific appointment. Tracked in `appointment_actions`. Has its own `status` (scheduled, sent, completed, etc.).

**Appointment type.** Org-scoped configuration: name, modality, default fee, default duration, linked workflow templates. Created in Settings.

**Assigned location.** A location the user has a `staff_assignments` row for. Different from selected location.

**Auto-expand.** Run sheet behaviour where rooms with priority sessions expand to show the priority sessions, but not all sessions.

**Background notifications.** Tab title flashing, favicon badge, and (optionally) browser push notifications. Fire across all assigned locations, not just the selected one.

**Bulk actions.** Run sheet operations applied to multiple sessions at once. Bulk nudge, bulk admit. No bulk process.

**Card on file.** A `payment_methods` row capturing a Stripe payment method for a patient. Captured during entry flow or intake package.

**Cascading configuration.** Configuration model where settings flow top-down: org defaults → location overrides → clinician preferences. Some categories (payment routing, branding, tier) are locked at higher levels.

**Charge.** The receptionist's act of taking payment in the process flow. Distinct from card capture (which doesn't move money).

**Checked in.** Session status. Patient has physically arrived (in-person only). Run sheet shows them ready for the clinician.

**Clinic-side.** Anything in `src/app/(clinic)/`, `src/components/clinic/`, or `src/lib/clinic/`. Staff-facing surfaces. Distinct from patient-side.

**Clinician.** A staff role with session-level access. Starts and ends calls; doesn't drive operations or take payment.

**Clinic Owner.** The first user to sign up. Counts as both a Practice Manager and a Clinician for permission purposes. One per org.

**Collection-only.** A workflow template `terminal_type`. Used for packages that aren't tied to a scheduled appointment; the package collects forms and other items but doesn't end at a run-sheet session.

**Complete tier.** The full tier. PMS integration, workflow engine, in-person modality, forms, readiness dashboard, post-appointment automation. See `feature-tiers-and-roles.md`.

**Confirm-mode.** The intake journey's identity model. The clinic asserted the patient's identity at add-patient time; the journey verifies phone ownership and confirms the existing record rather than capturing a new one.

**Connect account.** A Stripe Connect account belonging to a location or a clinician (depending on routing). The destination for payments.

**Core tier.** The day-of operations tier. Telehealth only. No PMS, no workflow engine. See `feature-tiers-and-roles.md`.

**Custom Connect.** Stripe Connect's most flexible Connect account type, with controller properties. The model Coviu uses.

**Custom server.** `server.ts` at the root of the repo. Runs Next.js plus Socket.io on the same port.

**Deliver form.** The `deliver_form` workflow action type. Sends a single form to a patient. Legacy mechanism; new workflows use `intake_package` instead.

**Derived state.** Computed-at-render display state for sessions. `late`, `upcoming`, `running_over` are derived from the stored status plus the current time.

**Device test.** The browser-side WebRTC pre-flight check during the entry flow. Checks camera, microphone, and network. Skipped on in-person.

**Direction (workflow).** Whether a workflow template fires before or after the appointment. `pre_appointment` or `post_appointment`.

**Done.** Session status. Fully processed; archived from the active run sheet.

**Embedded intake journey.** The `<EmbeddedIntakeJourney>` wrapper component. Used when the entry flow's outstanding intake gate needs to render the existing intake journey UI inline with a pre-verified identity.

**Entry flow.** The unified arrival sequence on the patient side. Primer, OTP, identity, outstanding intake gate, card capture, device test, arrive. See `feature-patient-entry-flow.md`.

**Entry point.** One of four ways a patient reaches the platform: on-demand link, run sheet manual SMS, run sheet integrated SMS, QR code. All four converge on the same entry flow.

**Entry token.** A `sessions.entry_token`. The URL slug for an SMS-driven session entry link.

**EFTPOS terminal.** The framing for what Coviu is in the payment ecosystem. Coviu captures the transaction; the PMS is the ledger.

**Failed action.** An `appointment_actions` row with `status = 'failed'`. Surfaces on the readiness dashboard at the highest priority. Needs investigation.

**Fired (action).** A workflow action that has executed (passed through the `firing` status to a terminal status). The opposite of `scheduled`.

**Form (Coviu).** A SurveyJS-driven configurable patient questionnaire. Org-scoped. Created in Forms settings.

**Form submission.** A patient's completed response to a form. Stored as a `form_submissions` row.

**Handoff (transcription).** The receptionist's flow on the readiness dashboard for reviewing completed intake data and copying it into the PMS, then marking transcribed.

**In progress.** Readiness dashboard priority. Patient has started the package or forms but hasn't completed.

**In session.** Session status. Call is active or in-person consultation is happening.

**In-person.** Modality. Patient physically attends. Complete tier only.

**Intake journey.** The patient-facing UI for completing an intake package. `<IntakeJourney>` component, rendered at `/intake/[token]`.

**Intake package.** A bundled pre-appointment journey containing forms, card capture, and consent. Workflow action type. See `feature-intake-package.md`.

**Intake reminder.** The `intake_reminder` workflow action type. Re-sends the intake package URL if the patient hasn't completed it.

**Journey token.** An `intake_package_journeys.journey_token`. The URL slug for an intake package's patient-facing link.

**Late.** Derived session state. Stored status is `queued`, scheduled time has passed, patient hasn't arrived. Highest run sheet priority.

**Link token.** A `rooms.link_token`. The URL slug for an on-demand entry link tied to a room.

**Location.** A physical or logical site of a clinic. An organisation has one or more locations.

**Modality.** Telehealth or in-person. An attribute of an appointment type.

**Modality filter.** A workflow action block field that gates whether the action fires based on the appointment's modality. `telehealth`, `in_person`, or null (both).

**Morning scan.** The periodic job that spawns sessions from today's appointments. Runs at run sheet build time.

**Multi-contact picker.** The identity confirmation step's UI for choosing which patient on a phone is here today. Used when one phone has multiple patient records in the org (parent + children).

**Notification (background).** See "background notifications."

**On-demand.** An entry type. The patient clicks a room link with no pre-existing appointment. A session is created at arrival.

**Optimistic update.** The pattern of updating local state immediately when a user takes an action, before the server confirms. Used throughout the clinic-side flows. See `conventions-realtime-and-state.md`.

**Org / Organisation.** The top of the clinic hierarchy. Carries tier, branding, payment routing model. One org per clinic; multi-location clinics have one org with several locations.

**Outcome pathway.** A pre-configured post-appointment branch. Selected by the receptionist during processing. Each pathway is linked to a post-appointment workflow template.

**Outstanding intake gate.** The arrival flow step that blocks a patient with an unfinished intake package from reaching the waiting room. See `feature-patient-entry-flow.md`.

**Patient-side.** Anything in `src/app/(patient)/`, `src/components/patient/`, or related routes. Patient-facing surfaces.

**Payment intent.** A Stripe primitive. Coviu creates one per charge against the patient's saved payment method, confirmed inline.

**Payment method.** A patient's stored card. Stripe terminology; Coviu mirrors it as `payment_methods`.

**PHI.** Protected health information. Patient identifiers, names, dates of birth, phone numbers, form responses. Should not be logged in production.

**Plan tomorrow.** The run sheet "+ Add session" panel toggle that switches between today's run sheet and tomorrow's.

**PMS.** Practice Management System. Cliniko, Halaxy, Power Diary, Nookal, Best Practice, MedicalDirector. Coviu integrates with these.

**Practice Manager.** Non-clinical admin role. Configures the platform; doesn't appear on the run sheet.

**Pre-appointment.** Workflow direction. Actions that fire before the visit.

**Primer.** The patient-side landing screen at the start of the entry flow. Not a numbered step.

**Process flow.** The receptionist's sequential flow for closing out a session: payment, outcome pathway (Complete only), done. See `feature-process-flow.md`.

**Progressive setup gate.** The middleware-enforced flow that walks a new user from authenticated through clinic creation through room creation. See `feature-auth-and-clinic-setup.md`.

**Push (PMS).** An outbound API call to the PMS informing it of an event (payment, arrival, cancellation).

**QR code.** An in-person check-in entry type. Patient scans a QR code in the waiting room. Complete only.

**QR token.** A `locations.qr_token`. The URL slug embedded in the QR code.

**Queued.** Session status. Session exists; patient hasn't arrived.

**Readiness dashboard.** The pre-appointment punch list. Recently renamed to "Tasks" in the sidebar. URL is still `/readiness`.

**Reception (entry).** A receptionist arriving at work and checking the run sheet for the day. Not a feature in the codebase, just the framing for the receptionist's day.

**Reconcile (payment).** The PMS recording a Coviu-captured payment in its accounts receivable. Driven by the outbound payment push.

**Resolved (action).** A workflow action that has reached a terminal state.

**RLS.** Row-Level Security. Postgres feature used to enforce per-user access at the database level. Mandatory in this codebase. See `conventions-prototype-vs-production.md`.

**Room.** An organisational container that groups sessions on the run sheet. A room belongs to a location.

**Routing (Stripe).** The decision of which Stripe Connect account a payment goes to. Org-locked: location-level or clinician-level.

**Run sheet.** The real-time operational dashboard at the heart of the clinic-side experience. See `feature-runsheet.md`.

**Running over.** Derived session state. Stored status is `in_session`, scheduled duration has passed.

**Selected location.** The location currently displayed in the location switcher. Drives most clinic-side data fetching and real-time subscriptions.

**Server actions.** Next.js server-side mutation functions. Used for clinic-side form submissions; revalidate cache tags or paths.

**Service-role client.** A Supabase client that bypasses RLS. Used in setup flows and patient-facing API routes. Never used in clinic-side feature code.

**Session.** The doing entity. Spawned from an appointment at run sheet build time, or created on the fly for on-demand entries. Tracks the patient's live visit lifecycle.

**Session participant.** A junction table row linking a session to a patient. Designed for multi-participant sessions; the MVP assumes one.

**SetupIntent.** A Stripe primitive. Coviu creates one per card capture; the patient completes Stripe Elements client-side and the resulting payment method is saved.

**Slug (room).** The kebab-case version of a room name used in the `?room=` query param of the entry URL.

**SMS provider.** The pluggable interface for sending SMS. Stubbed to console-log in the prototype.

**Solo practitioner.** A clinic owner with no receptionist. Processes their own sessions through the standard process flow.

**Stub.** An integration that's deliberately replaced with a fake for the prototype. SMS, PMS, parts of Stripe (test mode), email confirmation. See `conventions-prototype-vs-production.md`.

**Subscribe.** Open a real-time channel. Cleanly torn down on unmount or when the keying value changes.

**Tasks.** The user-facing label for the readiness dashboard sidebar item. URL and code still say `readiness`.

**Telehealth.** Modality. Patient and clinician join via video. Both Core and Complete.

**Template (workflow).** A workflow design-time configuration. Series of action blocks for one direction (pre or post).

**Terminal type.** A workflow template field. `run_sheet` (the package ends with the patient on the run sheet) or `collection_only` (the package collects data without a session).

**Terminal status (action).** An `appointment_actions` status that won't change further. `completed`, `transcribed`, `failed`, `skipped`, `cancelled`, `dropped`.

**Tier.** Core or Complete. Org-wide. Set at organisation level.

**Token (entry / link / QR / journey).** The URL slug used for patient-side authorisation. Different tokens for different entry types.

**Transcribed.** An `intake_package_journeys.transcribed_at` timestamp set by the receptionist. Indicates the package's data has been copied into the PMS.

**Type-workflow link.** A `type_workflow_links` row binding a workflow template to an appointment type for a specific phase (pre or post).

**Upcoming.** Derived session state. Stored status is `queued`, notification has been sent, patient hasn't acted.

**Verify (contact).** The `verify_contact` workflow action type. Asks the patient to verify their phone number is current.

**Waiting.** Session status. Patient is in the virtual waiting room (telehealth only).

**Workflow direction.** See "direction (workflow)."

**Workflow engine.** The Complete-tier automation system that fires SMS, packages, forms, and other actions before and after appointments. See `feature-workflow-engine.md`.
