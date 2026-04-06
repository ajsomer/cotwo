# Patient Contact Card — Wireframes

## Trigger

Clicking the **patient name** in a session row opens the contact card as a slide-over panel from the right. Only triggers when the session has a linked patient (`patient_id` is not null). If no patient contact exists yet (e.g. phone-number-only sessions that haven't been through identity confirmation), the name shows as the formatted phone number and is **not clickable** — no pointer cursor, no underline.

## Data Sources

The contact card pulls from:
- `patients` — first_name, last_name, date_of_birth
- `patient_phone_numbers` — phone number(s) for this patient
- `payment_methods` — card on file (brand, last four, expiry)
- `sessions` (+ `appointments`) — visit history at this clinic

For seeded patients, all of this data already exists in seed.sql.

---

## Wireframe: Contact Card Slide-Over

Width: `360px` (matches existing slide-over pattern)

```
┌─────────────────────────────────────┐
│  ← Patient details            [  ✕ ]│  <- SlideOver header
├─────────────────────────────────────┤
│                                     │
│   ┌──────┐                          │
│   │  EC  │  <- initials avatar      │
│   └──────┘                          │
│   Emily Chen                        │  <- text-xl font-semibold
│   DOB: 15 Mar 1992 (34)             │  <- text-sm text-gray-500, age calculated
│                                     │
├─────────────────────────────────────┤
│                                     │
│   CONTACT                           │  <- section label, text-xs uppercase gray-500
│   ┌─────────────────────────────┐   │
│   │  📱  +61 412 345 001        │   │  <- primary phone
│   └─────────────────────────────┘   │
│                                     │
├─────────────────────────────────────┤
│                                     │
│   PAYMENT                           │
│   ┌─────────────────────────────┐   │
│   │  💳  Visa ending 4242       │   │  <- card on file
│   │      Expires 12/27          │   │
│   └─────────────────────────────┘   │
│                                     │
│   — or if no card —                 │
│                                     │
│   ┌─────────────────────────────┐   │
│   │  No card on file            │   │  <- text-sm text-gray-400
│   └─────────────────────────────┘   │
│                                     │
├─────────────────────────────────────┤
│                                     │
│   TODAY'S SESSION                   │
│   ┌─────────────────────────────┐   │
│   │  9:30 AM  ·  Initial Consult│   │  <- scheduled time + type
│   │  Dr Smith's Room             │   │  <- room name
│   │  ● In Session                │   │  <- status badge (reuse StatusBadge)
│   │  Telehealth 📹               │   │  <- modality
│   └─────────────────────────────┘   │
│                                     │
├─────────────────────────────────────┤
│                                     │
│   VISIT HISTORY                     │
│   ┌─────────────────────────────┐   │
│   │  02 Apr 2026  Follow-up     │   │  <- previous session
│   │  28 Mar 2026  Initial Consult│  │
│   │  15 Mar 2026  Initial Consult│  │
│   └─────────────────────────────┘   │
│                                     │
│   — or if first visit —             │
│                                     │
│   ┌─────────────────────────────┐   │
│   │  First visit                │   │  <- text-sm text-gray-400
│   └─────────────────────────────┘   │
│                                     │
└─────────────────────────────────────┘
```

---

## Wireframe: Session Row — Name Clickability

Current row (no patient linked — phone only):
```
┌──────────┬──────────────────────────────────────────┐
│ 10:00 AM │  0412 345 003          ● Queued          │
└──────────┴──────────────────────────────────────────┘
              ^ plain text, not clickable
```

Row with linked patient:
```
┌──────────┬──────────────────────────────────────────┐
│  9:30 AM │  Emily Chen_           💳  ● In Session  │
└──────────┴──────────────────────────────────────────┘
              ^ underline on hover, pointer cursor
                click opens contact card slide-over
```

---

## Sections Breakdown

### 1. Header — Avatar + Name + DOB
- **Initials avatar**: 48x48 circle, `bg-teal-50 text-teal-600`, two-letter initials (first + last)
- **Name**: `text-xl font-semibold text-gray-800`
- **DOB line**: `text-sm text-gray-500` — formatted as "15 Mar 1992 (34)" with calculated age. Hidden if DOB is null.

### 2. Contact Section
- Phone number formatted as `+61 412 345 001`
- Uses `lucide-react` Phone icon, `text-gray-500`
- If multiple phone numbers exist, list all with a "(primary)" label on the primary one

### 3. Payment Section
- Card icon + brand + last four + expiry
- Uses `lucide-react` CreditCard icon
- Empty state: "No card on file" in `text-gray-400`

### 4. Today's Session
- Shows the current session context (the one that was clicked)
- Time, appointment type, room, status badge, modality
- Reuses existing `StatusBadge` and `ModalityBadge` components

### 5. Visit History
- Past sessions for this patient at this org (status = `done`)
- Query: sessions joined through session_participants where patient_id matches, ordered by created_at desc, limit 10
- Each row: date + appointment type name
- Empty state: "First visit" in `text-gray-400`

---

## Interaction Design

| Action | Behaviour |
|--------|-----------|
| Click patient name in session row | Opens contact card slide-over |
| Click backdrop or ✕ | Closes contact card |
| Press Escape | Closes contact card |
| Click patient name when no patient_id | Nothing (not clickable) |
| Contact card open + click different patient name | Swaps content to new patient |
| Contact card open + click action button on row | Contact card closes, action fires normally |

---

## Component Structure

```
src/components/clinic/
  patient-contact-card.tsx    <- the slide-over content
  session-row.tsx             <- modify: make patient name a clickable element
                                 when patient_id exists, call onPatientClick

src/app/api/patient/[id]/route.ts  <- new API: fetch full patient details
                                       (phone numbers, payment methods, visit history)
```

### API Response Shape

```typescript
// GET /api/patient/:id?session_id=xxx
{
  patient: {
    id: string;
    first_name: string;
    last_name: string;
    date_of_birth: string | null;
  };
  phone_numbers: {
    phone_number: string;
    is_primary: boolean;
  }[];
  payment_methods: {
    card_brand: string;
    card_last_four: string;
    card_expiry: string | null;
    is_default: boolean;
  }[];
  current_session: {
    scheduled_at: string | null;
    type_name: string | null;
    room_name: string | null;
    status: SessionStatus;
    modality: AppointmentModality | null;
  };
  visit_history: {
    date: string;
    type_name: string | null;
  }[];
}
```

---

## Seed Data Coverage

All 6 seeded patients have names, DOB, and phone numbers. 3 have cards on file (Emily Chen, Marcus Williams, David Park). Visit history will show only today's seeded sessions initially — no historical sessions exist in seed data, so most patients will show "First visit" in the history section. This is fine for prototype purposes.
