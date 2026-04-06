# Patient Contact Card and Dev OTP Display

**Date:** 2026-04-07

## What changed

### Dev OTP in browser console
OTP codes were only logged server-side, which meant switching to the terminal to grab the code during patient entry testing. The `/api/patient/otp/send` endpoint now returns a `dev_code` field when `NODE_ENV === 'development'`. The phone verification component logs it to the browser console: `[DEV] OTP code for +61...: 123456`. Only included in dev — production responses omit the field entirely.

### Patient contact card (new feature)
Added a slide-over panel that shows full patient details when clicking a patient name on the run sheet. Built on the existing `SlideOver` component pattern (360px, right-side).

**Trigger:** Clicking the patient name in a session row. Only clickable when the session has a linked `patient_id` — phone-number-only rows (patient hasn't gone through identity confirmation yet) remain plain text, not clickable. Patient names show underline-on-hover with teal colour shift to indicate clickability.

**Card sections:**
1. **Header** — Initials avatar (teal-50 circle), full name, DOB with calculated age
2. **Quick actions** — "Take payment" (only when card on file) and "Send SMS" (always). Both stubbed to `console.log` for now, to be wired to real endpoints later
3. **Contact** — Phone number(s) from `patient_phone_numbers`, primary label when multiple exist
4. **Payment** — Card brand, last four, expiry from `payment_methods`. Empty state: "No card on file"
5. **Today's session** — Scheduled time, appointment type, room, status badge, modality. Reuses existing `StatusBadge` component
6. **Visit history** — Past completed sessions for the patient. Empty state: "First visit"

**API:** New `GET /api/patient/:id?session_id=xxx` endpoint fetches patient, phone numbers, payment methods, current session context, and visit history in parallel using the service client.

**Click behaviour change:** Session row click previously opened the add/edit session panel. Now the patient name is a separate click target (with `stopPropagation`) that opens the contact card. The add/edit session panel remains accessible via the "+ Add session" button. Row-level click still works for the rest of the row area.

### Quick action buttons (stubbed)
Two quick action buttons sit below the patient name/DOB in the contact card header. These are patient-scoped ad hoc actions, deliberately separate from the session lifecycle Process flow (which moves sessions through payment > outcome > done).

- **Take payment** — for charging card on file without advancing session status. Visible only when patient has a card on file.
- **Send SMS** — for resending prep links or nudges. Always visible.

Both log to browser console with patient ID, session ID, and phone number context. Real endpoints to be wired later.

## Files changed

| File | Change |
|------|--------|
| `src/app/api/patient/otp/send/route.ts` | Return `dev_code` in dev mode |
| `src/components/patient/phone-verification.tsx` | Log OTP to browser console |
| `src/app/api/patient/[id]/route.ts` | **New** — patient details API |
| `src/components/clinic/patient-contact-card.tsx` | **New** — contact card slide-over |
| `src/components/clinic/session-row.tsx` | Patient name as clickable button when `patient_id` exists |
| `src/components/clinic/room-container.tsx` | Pass `onPatientClick` through to session rows |
| `src/components/clinic/runsheet-shell.tsx` | Contact card state management, `handlePatientClick`, render `PatientContactCard` |
| `docs/plans/patient-contact-card/wireframes.md` | **New** — wireframe spec and interaction design |

## Design decisions

- **Quick actions vs Process flow:** The Process flow is the "close out this session" pipeline (payment > outcome > done). Quick actions on the contact card are independent — a receptionist can take a payment or send an SMS without advancing the session lifecycle. This came from feedback that some clinics want to charge (e.g. no-show fees) without triggering post-appointment workflows.
- **Name clickability gating:** Only sessions with a confirmed patient identity show a clickable name. This avoids opening an empty contact card for sessions where the patient is just a phone number. The visual affordance (underline on hover, teal colour) makes it clear which names are interactive.
- **Separate click targets:** Patient name click opens contact card, action buttons on the row still fire their respective actions. `stopPropagation` on the name click prevents the row-level handler from also firing.

## What's next

- Wire up "Take payment" to Stripe charge endpoint
- Wire up "Send SMS" to SMS provider
- Consider additional quick actions as the workflow engine matures
- Patient entry flow mapping (deferred from this session)
