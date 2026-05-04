# Feature: PMS Integration

Complete-tier prerequisite. PMS integration is the gating dependency for the entire Complete tier: in-person modality, run-sheet integrated entry, payment write-back, appointment sync, AI scribe routing. Without it, none of those work.

In the prototype the integration is **not yet built**. The schema has the columns to support it (`pms_external_id` on `appointments` and `appointment_types`, `appointment_type_source` enum), and there's a placeholder route at `/api/pms/sync` that returns `{ synced: true }` without doing any work. There is no `src/lib/pms/` directory, no adapter interface in code, no fixtures, and no Cliniko-specific implementation. This doc therefore describes the *intended* shape of the integration; treat it as a design sketch, not a description of running code.

---

## Why PMS integration matters

Most allied health clinics already have a PMS: Cliniko, Halaxy, Power Diary, Nookal, Best Practice, MedicalDirector. The PMS owns the long-term record: the patient's clinical history, the clinic's appointment calendar, the billing ledger. Coviu cannot replace that, and is not trying to.

Coviu integrates with the PMS to:

1. **Pull appointments inbound.** The PMS is the source of truth for who's coming in tomorrow. Coviu's run sheet should reflect what the PMS has.
2. **Push transaction data outbound.** When Coviu captures a payment, the PMS needs the record so it can reconcile.
3. **Push arrival data outbound.** When a patient checks in (in-person QR, telehealth waiting), the PMS needs to know so its calendar reflects reality.
4. **Sync appointment metadata.** Cancellations, reschedules, no-shows.

Without PMS integration, the clinic has to manually duplicate data between two systems. With it, Coviu is invisible plumbing on top of the PMS.

This is why **Complete tier requires PMS integration**: it's the foundation that the Complete-only features rely on. A clinic can't activate the workflow engine effectively without appointments flowing in, and can't justify the receptionist using Coviu for processing without the PMS reconciling at the back.

## The intended adapter pattern

The integration will be structured as an adapter interface so additional PMS systems can be added without rewriting the core logic.

The intended shape of the adapter:

```
PMSAdapter:
  syncAppointments(locationId, dateRange) → AppointmentRecord[]
  pushPayment(paymentId) → ExternalReference
  pushArrival(sessionId) → ExternalReference
  pushAppointmentStatus(appointmentId, status) → void
```

Each adapter implementation will map Coviu's data model to and from the target PMS's API. The adapter handles auth (OAuth in the case of Cliniko), retries, error reporting, and rate limiting.

The interface will live at `src/lib/pms/` once it's written. Concrete implementations would live alongside it: `cliniko.ts`, `halaxy.ts`, etc. A fixture-driven stub adapter (`prototype-stub.ts` or similar) is the natural first thing to write — it returns pre-configured fixture data for `syncAppointments` and console-logs for the push methods, which is enough for the rest of the codebase to develop against.

None of this exists in the codebase yet. The schema columns and the placeholder route are the only present-day artefacts.

## Sync mechanics (Cliniko first)

Cliniko is the first real integration target. The architecture sketch:

**Inbound sync** runs as a periodic job. For each connected clinic location:

1. Fetch appointments from Cliniko's API for the relevant date range.
2. Map Cliniko appointment types to Coviu appointment types via `appointment_types.pms_external_id`.
3. For each Cliniko appointment, upsert a corresponding Coviu appointment row.
4. For new appointments, schedule the linked workflow template (this triggers SMS, intake packages, etc.).
5. For updated appointments (reschedule, cancel), update the Coviu row and adjust scheduled actions accordingly.

**Outbound push** runs on event:

- A payment completes in Coviu → the adapter pushes a transaction record to Cliniko.
- A patient arrives (in-person) → the adapter pushes an arrival event to Cliniko.
- An appointment is cancelled in Coviu → the adapter pushes a cancellation to Cliniko.

The frequency and exact payload shape is part of the Cliniko-specific implementation. The adapter pattern abstracts those details from the rest of the codebase.

## How often inbound sync runs

In the prototype, inbound sync runs **on demand** rather than continuously. There's no Cron, no real-time hook into the PMS. For a real integration:

The likely production pattern is a periodic scan (every 15-30 minutes) plus an inbound webhook for time-critical updates (cancellations the day-of). The exact cadence is a Cliniko-specific decision and lives with the real adapter implementation.

In the prototype, the relevant route handler exists at `src/app/api/pms/sync/route.ts` and can be called manually for testing. It runs against the stub today.

Don't build features that assume sub-second PMS sync. Treat PMS data as eventually-consistent on the order of minutes.

## Mapping appointment types

The most fragile part of any PMS integration is mapping the PMS's appointment types to Coviu's. Each PMS has its own taxonomy ("Initial Consultation," "Follow-up," "Treatment Session") and Coviu has its own. The mapping:

- Coviu `appointment_types.pms_external_id` is set when a Practice Manager links a Coviu type to a PMS type during configuration.
- Inbound sync looks up the Coviu type by `pms_external_id` and assigns the appointment.
- If no mapping exists for an incoming appointment type, the appointment is skipped or routed to a default ("Untyped consultation"). The Practice Manager sees an alert to configure the mapping.

The mapping UI lives in Settings → Appointment Types (Complete only). Practice Managers connect the PMS once during setup, then map types as needed.

## What exists today

- **The schema columns.** `appointments.pms_external_id`, `appointment_types.pms_external_id`, and the `appointment_type_source` enum (`coviu | pms`) are all present. Today everything is `coviu` because nothing comes from a real PMS yet.
- **A placeholder sync route.** `src/app/api/pms/sync/route.ts` returns `{ synced: true }` without doing any work. Useful for testing that the route exists; not useful for syncing anything.
- **Seed data that pretends.** The Complete-tier seed sets the org's tier to `complete` and pre-populates appointments as if they had been synced. Day-of operations work because the appointments exist, even though the underlying integration is fictional.

## What does not exist

- The `src/lib/pms/` directory.
- The adapter interface in code.
- A stub adapter implementation.
- Fixture data files.
- Any Cliniko-specific code.
- A working sync handler.
- PMS authentication flow.
- Inbound webhook subscriptions.

## What gets built at handoff

The engineering handoff includes:

1. Implementing the Cliniko adapter against the real Cliniko API.
2. Wiring up Cliniko's OAuth or API key setup in Settings → Payments / PMS (a new sub-page may be needed).
3. Setting up the periodic inbound sync (likely as a job runner or Cron rather than inside the Next.js process).
4. Subscribing to Cliniko webhooks for time-critical updates.
5. Implementing the appointment type mapping UI's actual Cliniko queries.
6. Running real outbound pushes for payments, arrivals, and cancellations.
7. Hardening the adapter against API failures (retries, circuit breakers, alerting).

This is non-trivial work and is one of the larger workstreams at handoff.

## Where to look

- **Adapter interface and stub:** `src/lib/pms/` (does not exist yet; this is where it will go).
- **Sync route:** `src/app/api/pms/sync/route.ts` (placeholder; returns `{ synced: true }` without syncing).
- **Appointment type mapping:** `src/components/clinic/appointment-type-editor.tsx` (the field where `pms_external_id` is set).
- **Schema:** `appointments.pms_external_id`, `appointment_types.pms_external_id`, `appointment_type_source` enum.

## Related docs

- `feature-tiers-and-roles.md` for why Complete requires PMS integration.
- `feature-runsheet.md` for the run-sheet integrated entry point (which depends on inbound sync).
- `feature-payments.md` for the outbound payment push.
- `feature-patient-entry-flow.md` for the QR check-in flow that pushes an arrival.
- `feature-workflow-engine.md` for the workflow scheduling that fires on synced appointments.
- `conventions-prototype-vs-production.md` for the stubbing inventory.
