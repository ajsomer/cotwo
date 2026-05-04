# 00: Product Overview

## What are you trying to achieve?

We are building the Coviu MVP: a working prototype of a complete redesign of the Coviu platform, built to production standards but deployed as a prototype. By the end of the build, we should be able to walk a clinic from sign-up through their first day of operation: telehealth and in-person appointments, a real-time run sheet, patient arrival flows, payments, and (for Complete tier) the workflow engine and the readiness dashboard. Every screen a real user would see, every interaction a real user would perform, working end to end.

The MVP exists to do three things. First, **prove the product vision**: that the digital front door framing holds up under the weight of real clinical operations. Second, **de-risk the engineering handoff**: the build is structured so the production team inherits a system whose architecture, data model, and feature behaviour are already settled, not a wireframe with implementation guesses. Third, **earn buy-in from the clinics, the internal team, and the engineering organisation** by replacing slide decks and Figma flows with something that actually works.

Documentation in this project supports the build, not the strategy behind it. Strategy lives elsewhere; the decisions it encodes are already baked into the architecture and feature specs you'll find here. What this documentation set provides is the working context an engineer, designer, or AI agent needs to make correct decisions while building: the conceptual model, the data model, how features behave today, what's stubbed versus real, and where to look for detail when the summary isn't enough. Read it as scaffolding for execution, not as a record of why we're executing.

Success looks like: an end-to-end happy path runs across both tiers (sign-up and clinic setup, a real-time run sheet, telehealth and in-person arrivals, payments, the workflow engine, the readiness dashboard, and outcome pathway selection) without any contributor needing to ask "wait, how is this supposed to work?" That is the bar. The Complete-tier surfaces (workflow engine, in-person QR check-in, readiness) are the hardest parts to prove with Figma and the highest-value parts to demo working, so they are not optional.

---

## What Coviu is

Coviu is the digital front door for allied health and specialist clinics in Australia. It owns the end-to-end digital patient experience from the moment an appointment exists through to post-consultation follow-up, for both telehealth and in-person appointments. The product replaces the patchwork of SMS reminders, ad-hoc forms, manual phone calls, separate video tools, and spreadsheet-driven receptionist workflows that most allied health clinics rely on today.

A clinic running on Coviu sees their day as a single live operational dashboard (the **run sheet**) that updates in real time as patients respond to messages, arrive, get processed, and leave. Patients see one consistent flow regardless of how they were invited (SMS link, room link, QR code at reception). Receptionists drive that flow forward; clinicians focus on the consultation; practice managers configure the platform.

Coviu is not a Practice Management System (PMS). It is the digital layer on top of the PMS: Coviu owns the patient experience, the PMS owns the clinical record, the billing ledger, and the long-term scheduling. The two systems exchange information (appointment sync inbound, payment and arrival data outbound) but each has a clear scope. "Coviu is the EFTPOS machine, the PMS is the ledger" is a useful phrase: Coviu captures the transaction and the experience around it, the PMS records the long-term consequences.

## Who uses it

Five user types, four of them inside the clinic:

- **Clinic Owner**: the first user to sign up. A practising clinician who also owns and administers the clinic. Counts as both a Practice Manager and a Clinician for permission purposes, plus carries account ownership (billing, subscription). Paid seat. One per organisation.
- **Practice Manager**: non-clinical admin. Configures workflows, forms, rooms, and team. Does not appear on the run sheet as a provider and has no clinician capabilities. Free seat.
- **Receptionist**: day-to-day operations. Drives the run sheet, takes payments, selects outcome pathways. Cannot modify platform configuration.
- **Clinician**: session-level access only. Starts telehealth calls from the run sheet, sees their assigned rooms. Preference-level settings only.
- **Patient**: uses the platform without an account. Identity is verified per-visit by phone OTP. Mobile-first arrival flow.

The five roles map to two primary surfaces (clinic-side and patient-side) with different layouts, different real-time channels, and different auth models. Most documentation is split along that line.

## Tier structure: Core vs Complete

Coviu ships in two tiers, and most decisions in this build live or die on which tier they apply to.

**Core** is the day-of operations tier. Telehealth only. No in-person modality, no QR code check-in. No PMS integration required. Includes the full run sheet, manual session entry, payments, telehealth video, and a one-shot pre-appointment SMS. Does **not** include the workflow engine, forms, the readiness dashboard, post-appointment automation, or AI scribe routing. Aimed at smaller clinics and practitioners who want digital front-door operations without committing to a PMS integration.

**Complete** is the full digital front door. PMS integration is a prerequisite. Adds in-person modality (with QR check-in), the bidirectional workflow engine (replacing the one-shot SMS with configurable timed actions across days or weeks), forms, intake automation, the readiness dashboard, post-appointment outcome pathways, follow-up automation, and AI scribe routing.

This tier split shows up everywhere in the codebase: in middleware checks, in sidebar visibility, in feature flags, in seed data. A common failure mode is to build a feature that "feels right" but quietly assumes Complete-tier infrastructure (a workflow engine action, a form, a readiness signal) that does not exist on Core. Always check which tier you're building for. See `feature-tiers-and-roles.md` for the full visibility matrix and the role-by-tier permissions table.

## Why this matters for documentation

Three implications shape how the rest of this documentation set is organised, and worth flagging up front:

1. **Clinic-side and patient-side are genuinely different surfaces.** They share a database and some primitives (sessions, rooms) but they have different layouts, different state stores, different real-time channels, and different auth. When a doc says "the X flow," check whether it means the staff-facing or patient-facing one. They are rarely the same thing.

2. **The tier boundary is load-bearing.** A change that is correct on Complete may be a regression on Core. A new action type, a new dashboard signal, a new patient-flow step: all of these need a tier decision before they ship. The conventions docs and the tiers-and-roles doc are where to look when in doubt.

3. **The system is built to production standards but deployed as a prototype.** This sounds like a contradiction; it isn't. The architecture, the data model, the RLS policies, and the auth chain are all real and all final. The SMS provider, the video platform, the demo data, and the email confirmation flow are stubbed, configurable, or disabled, with deliberate seams for the production team to swap in real implementations. `conventions-prototype-vs-production.md` is the inventory of what falls on which side of that line and is referenced more often than any other conventions doc.

## Where to start

If you're new to the project, read in this order:

1. This document.
2. `01-core-concepts.md`: the conceptual vocabulary the rest of the docs depend on.
3. `02-architecture.md`: how the system is put together.
4. `03-data-model.md`: the schema as a narrative.

After that, the feature docs in Tier 2 are pulled in based on what you're working on. The conventions docs in Tier 3 are referenced constantly and worth at least skimming. The reference and roadmap docs in Tiers 4 and 5 exist for lookup, not linear reading.
