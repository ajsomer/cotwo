# Forms Platform and Readiness Dashboard

**Date:** 2026-04-07

## What changed

### SurveyJS forms integration (new feature)

Built the full forms pipeline: clinic-side form builder, patient-facing form renderer, manual SMS delivery, and form assignment tracking. This is the foundation for the readiness dashboard and eventually the workflow engine.

**Form builder** — SurveyJS Creator wrapped in a Next.js dynamic import (`ssr: false`) at `/forms/[id]`. Practice managers can build forms with a drag-and-drop editor. Available question types: text, comment, radiogroup, checkbox, dropdown, boolean, rating, matrix, html, panel, file (photo upload), signaturepad, paneldynamic, multipletext, tagbox, ranking. The Creator's built-in preview tab is replaced with a custom preview button that renders the form using our patient-facing renderer, so what you see in preview is exactly what the patient sees.

**Form renderer** — Patient-facing page at `/form/[token]`. Custom header treatment above the SurveyJS form body: clinic logo (or teal initial fallback), clinic name, divider, form title, subtitle. Custom segmented progress bar showing page completion. SurveyJS renders the form body with the Coviu theme applied. On completion, responses are POSTed to the API and the assignment status flips to `completed`.

**Schema versioning** — When a form is assigned to a patient, the form's current schema is snapshotted into `form_assignments.schema_snapshot`. The patient renderer reads from the snapshot, not the live form. This means editing a published form doesn't break in-flight assignments.

**Assignment model** — `form_assignments` table bridges forms → patients → appointments. Each assignment has a unique token used in the patient URL. Status lifecycle: pending → sent → opened → completed. Forward-only transitions. Resending SMS updates `sent_at` but doesn't reset status.

**SMS delivery** — Uses the existing `getSmsProvider()` pattern. Console logs in dev, Vonage in prod. The assignments panel has a "Create & Send" flow and a per-assignment "Resend SMS" button. Assignment creation logs the patient form URL to the browser console for dev testing.

### Database changes

**Migration 007:** Added `schema` (JSONB) and `status` (draft/published/archived) columns to `forms`. Created `form_assignments` table with `schema_snapshot`, status tracking, timestamps, and RLS policies. Added INSERT/UPDATE/DELETE policies on `forms` (previously only SELECT existed).

**Migration 008:** Inserted 8 form templates (see below).

### Form templates

Eight pre-built templates, all published and ready to assign:

1. **New patient intake** — 5 pages: personal details, contact info, emergency contact, Medicare details, medical history and consent. Side-by-side fields on desktop (first/last name, Medicare number/IRN). Conditional visibility on medical conditions follow-up.
2. **Referral upload** — File upload (photo/PDF) with referring doctor details. Uses the `file` question type with camera support on mobile.
3. **Consent to telehealth** — Three pages explaining telehealth, privacy notice, consent checkboxes, signature pad, date.
4. **Mental health assessment (K10)** — Standardised Kessler 10-question scale. Scored responses (1-5 per question). Single page, numbered questions.
5. **Pain assessment** — Body area selector, 0-10 rating scales (current/worst/best), duration, frequency, impact on daily life.
6. **Patient satisfaction survey** — Star rating, service quality matrix, NPS-style recommendation, free-text feedback.
7. **NDIS intake** — NDIS number with 9-digit validation, plan management type with conditional fields, dynamic goals list, support coordinator details, consent with signature.
8. **Pre-appointment screening** — Symptom checklist, COVID/influenza exposure, travel history, declaration with signature.

Templates use proper panel structure — fields grouped inside panels, page titles as section headings, no panel titles (to avoid duplicate headings). Side-by-side layouts via `startWithNewLine: false`. Conditional visibility via `visibleIf` expressions.

### Coviu SurveyJS theme

Central theme file at `src/lib/survey/theme.ts`. Based on `default-light` with Coviu brand tokens:
- Teal-500 primary, amber secondary
- Warm gray backgrounds (F8F8F6 page, white panels)
- 12px corner radius, Inter font
- Soft panel shadows for card elevation
- Applied to both patient renderer and Creator preview

### Patient form page layout

The patient layout (`src/app/(patient)/layout.tsx`) was updated to remove the global `max-w-[420px]` constraint. Each patient page now sets its own width: entry/waiting/pay pages wrap in `max-w-[420px]`, the form page uses `max-width: 680px` for a wider form experience on desktop while filling the viewport on mobile.

### Forms list page

`/forms` — table with name, status badge (draft/published/archived), assignment counts (completed/total), last updated date. New form button creates an "Untitled Form" and navigates to the builder. Send button (published forms only) opens the assignments slide-over. Delete button with active-assignment protection.

### Readiness dashboard (new feature)

`/readiness` — Complete tier only, visible to receptionists, practice managers, clinic owners. Shows outstanding form assignments grouped by day.

**Layout:** Day-grouped sections ("Past — clinical record incomplete", "Today", "Tomorrow", then future dates). One row per appointment with outstanding forms. Collapsed row shows patient name, time, clinician, outstanding count, Resend SMS button, Call button (tel: link). Expanded row shows individual form lines with per-form status and resend.

**Empty state:** "All upcoming appointments are ready." with a teal checkmark.

**Polling:** Refreshes every 30 seconds. No Supabase Realtime subscription for V1.

**Known limitation:** The form assignments panel doesn't have an appointment selector yet, so assignments created manually don't link to appointments and won't appear on the readiness dashboard. This will be resolved when the workflow engine auto-creates assignments from appointment types.

### Patient slide-out — Forms section

Added a "Forms" section to the existing `PatientContactCard` slide-out. Shows all form assignments for the patient (both outstanding and completed) with status badges, relative timestamps, resend button for outstanding forms, and view button for completed submissions.

### PatientNameLink and PatientSlideOverContext

Created a universal pattern for opening the patient slide-out from anywhere in the product. `PatientSlideOverContext` provides an `openPatient(patientId)` callback. `PatientNameLink` component reads from the context and renders a clickable patient name with hover styling.

The `PatientContactCard` was refactored to accept either a `session` prop (existing pattern from the run sheet) or a `patientId` prop (new, for contexts without a session like the readiness dashboard). The run sheet's `RunsheetShell` is wrapped in `PatientSlideOverProvider`.

### API routes

| Route | Methods | Purpose |
|-------|---------|---------|
| `/api/forms` | GET, POST, PATCH, DELETE | Forms CRUD (org-scoped) |
| `/api/forms/[id]` | GET | Single form with full schema |
| `/api/forms/assignments` | GET, POST | List/create assignments (POST snapshots schema) |
| `/api/forms/assignments/send` | POST | Send SMS with form link |
| `/api/forms/fill/[token]` | GET, POST | Patient: resolve token + submit responses |
| `/api/forms/patients` | GET | List org patients for assignment selector |
| `/api/forms/submissions/[id]` | GET | Fetch completed submission with schema + responses |
| `/api/readiness` | GET | Outstanding forms grouped by appointment for a location |
| `/api/patient/[id]` | GET | Extended with form_assignments array |

## Files added/modified

### New files
- `supabase/migrations/007_forms_v1.sql`
- `supabase/migrations/008_form_templates.sql`
- `src/lib/survey/theme.ts`
- `src/lib/utils/url.ts`
- `src/app/api/forms/route.ts`
- `src/app/api/forms/[id]/route.ts`
- `src/app/api/forms/assignments/route.ts`
- `src/app/api/forms/assignments/send/route.ts`
- `src/app/api/forms/fill/[token]/route.ts`
- `src/app/api/forms/patients/route.ts`
- `src/app/api/forms/submissions/[id]/route.ts`
- `src/app/api/readiness/route.ts`
- `src/components/clinic/forms-shell.tsx`
- `src/components/clinic/form-builder-shell.tsx`
- `src/components/clinic/form-builder-wrapper.tsx`
- `src/components/clinic/form-assignments-panel.tsx`
- `src/components/clinic/readiness-shell.tsx`
- `src/components/clinic/patient-name-link.tsx`
- `src/components/clinic/patient-slide-over-context.tsx`
- `src/components/patient/form-fill-client.tsx`
- `scripts/rebuild-templates.mjs`
- `docs/specs/readiness-dashboard.md`

### Modified files
- `src/app/(clinic)/forms/page.tsx` — replaced stub
- `src/app/(clinic)/forms/[id]/page.tsx` — replaced stub
- `src/app/(clinic)/readiness/page.tsx` — replaced stub
- `src/app/(patient)/form/[token]/page.tsx` — replaced stub
- `src/app/(patient)/layout.tsx` — removed global max-width
- `src/app/(patient)/entry/[token]/page.tsx` — added 420px wrapper
- `src/app/(patient)/waiting/[token]/page.tsx` — added 420px wrapper
- `src/app/(patient)/pay/[token]/page.tsx` — added 420px wrapper
- `src/app/api/patient/[id]/route.ts` — extended with form_assignments
- `src/components/clinic/patient-contact-card.tsx` — added Forms section, patientId prop
- `src/components/clinic/runsheet-shell.tsx` — PatientSlideOverProvider wrapper
- `src/lib/supabase/types.ts` — Form, FormAssignment, FormSubmission types
- `package.json` — survey-core, survey-react-ui, survey-creator-core, survey-creator-react

## What's next

- **Workflow engine** — auto-create form assignments when appointments are created, based on appointment type → form linkage. Replaces manual assignment.
- **Appointment selector in assignments panel** — so manual assignments link to appointments and appear on the readiness dashboard.
- **FormSubmissionView** — proper read-only SurveyJS render in a slide-over for viewing completed submissions (currently opens raw API).
- **Supabase Storage for file uploads** — replace base64 storage with proper file upload to a storage bucket.
- **SurveyJS Creator license** — evaluation use is fine for the prototype. The engineering team needs a commercial license ($589+) for production.

## Notes

- SurveyJS installed cleanly on React 19 with no peer dependency issues.
- The `form_fields` table from the original schema is intentionally unused. SurveyJS JSON stored directly on `forms.schema` is the canonical source of truth.
- Form templates were rebuilt twice — first with flat structure (every question top-level), then with proper panel grouping after noticing excessive padding in the renderer.
