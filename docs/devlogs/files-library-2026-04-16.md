# Files Library Implementation

**Date:** 2026-04-16
**Scope:** Org-scoped PDF uploads, workflow delivery, patient-facing viewer

## What was built

End-to-end file sharing: practice managers upload PDFs to an org-scoped library, pathway actions reference files, the workflow engine delivers them via SMS, and patients view them in-browser.

### Database

- `files` table with soft-delete via `archived_at` (FK constraint from `file_deliveries` blocks hard delete)
- `file_deliveries` table with permanent token-based patient access and `viewed_at` tracking
- `clinic-files` Supabase Storage bucket (private, 10 MB limit, PDF only, org-scoped folder policies)
- RLS: staff read/write scoped to their org; deliveries created by service role, readable by staff

### API routes

- `GET/POST/DELETE /api/files` — list active files, upload (multipart), soft-delete
- `GET /api/files/preview` — staff-side signed URL generation (60-min expiry)
- `GET /api/files/view/[token]` — patient-facing: validates delivery token, generates ephemeral signed URL, tracks first view

### Clinic UI

- Sidebar nav renamed "Forms" → "Forms & Files"
- `FormsShell` now has a tab bar (Forms / Files) with consistent section headers
- `FilesPanel`: file list table (name, size, uploaded date), view icon (opens signed URL), archive button, upload modal with drag-and-drop zone
- `OutcomePathwayEditor`: "Send file" added to the action type picker alongside SMS, Send form, Task. Block detail shows file picker dropdown + SMS message textarea with `{file_link}` variable
- `ProcessFlowOutcome`: send_file actions render with file icon, file name summary, and inline file picker + message editor for customisation at Process time
- `ActionCard` (pre-appointment editor): stub replaced with real file picker dropdown

### Workflow engine

- `handleSendFile` handler: creates `file_delivery` row with unique token, interpolates SMS template (supports `{first_name}`, `{clinic_name}`, `{clinician_name}`, `{file_link}`), sends via SMS provider
- Wired into `executeHandler` switch — `send_file` no longer falls through to the stub

### Patient viewer

- `/files/view/[token]` page: clinic branding header, file info, PDF rendered in iframe via signed URL, download button
- Mobile-friendly (420px max-width on desktop, full-width on mobile)
- Invalid tokens show error state; archived files remain viewable

## Other changes in this session

- **Process flow performance**: outcome pathway list now reads from the Zustand store instead of making N+1 Supabase queries on every open. Instant rendering.
- **Clinic data provider**: `refreshFiles(orgId)` added to the org-scoped initial fetch alongside forms and workflows.
- **Seed button**: removed workflow data reset — now only populates patient/session data for the run sheet.
- **TS errors**: fixed pre-existing type cast issues in `/api/patient/[id]/route.ts`.

## Design decisions

| Decision | Rationale |
|----------|-----------|
| Permanent delivery token, ephemeral signed URL | Token in SMS never expires. Signed URL generated fresh on each page load (60-min expiry). Avoids stale URL problem. |
| Soft delete only | FK from `file_deliveries` blocks hard delete. Archived files hidden from library/pickers but storage object preserved so existing patient links keep working. |
| Store-driven pathway list | The `outcomePathways` slice already had blocks hydrated. Fetching from Supabase on every Process open added 1-2s latency with N+1 queries per pathway. |
| File picker on action blocks | `file_id` stored in `config.file_id` (same JSONB pattern as `message`, `task_title`). Snapshotted into `appointment_actions.config` at Process confirmation time. |

## Seed data

4 PDFs seeded into the demo org's file library (Depression, ADHD, Bipolar, Anxiety fact sheets). Uploaded to Supabase Storage bucket via CLI. File sizes updated to match actual files.
