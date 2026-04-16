# Files Library

Org-scoped file uploads, workflow delivery & patient viewer

April 2026

**CONFIDENTIAL**

## Overview

| **Surface** | Files tab on Forms & Files page, pathway editor file picker, patient-facing PDF viewer |
| --- | --- |
| **Users** | Practice managers (upload/manage files), receptionists (select files at Process), patients (view/download) |
| **Available to** | Complete tier |
| **Priority** | Demo feature — enables the "send a fact sheet" workflow use case |

The Files library is an org-scoped collection of PDFs that practice managers upload once and reuse across pathways. A psychologist uploads an "ADHD Fact Sheet" PDF. A pathway action block references it. When the receptionist processes a session and confirms the pathway, the engine sends the patient an SMS link. The patient taps the link and sees the PDF in their browser.

No draft/publish lifecycle. Files are live immediately on upload. No categories or tags. No relationship to appointment types — files are selected per-pathway and optionally swapped per-patient at Process time.

## Data Model

### New table: `files`

| **Column** | **Type** | **Notes** |
| --- | --- | --- |
| id | UUID PK | |
| org_id | UUID FK → organisations | Org-scoped library |
| name | Text | Display name. E.g. "ADHD Fact Sheet" |
| description | Text | Optional one-liner |
| storage_path | Text | Path in Supabase Storage bucket. E.g. `{org_id}/{file_id}.pdf` |
| file_size_bytes | Integer | For display ("2.4 MB") |
| mime_type | Text | Always `application/pdf` for v1 |
| uploaded_by | UUID FK → users | Who uploaded it |
| archived_at | Timestamp | NULL = active, set = soft-deleted. File hidden from UI but delivery links still work. |
| created_at | Timestamp | |

No `updated_at` — files are immutable once uploaded. To "update" a file, upload a new version and archive the old one (future).

**Soft delete via `archived_at`.** Files cannot be hard-deleted because `file_deliveries` rows reference them (FK constraint). Deleting a file sets `archived_at = now()`. The file disappears from the library UI and pathway editor pickers but existing delivery links continue to work — patients who received the file can still view it. The storage object is NOT deleted (preserves patient access). The `archived_at` column also prevents the file from being selected in new pathway configurations.

### New table: `file_deliveries`

| **Column** | **Type** | **Notes** |
| --- | --- | --- |
| id | UUID PK | |
| file_id | UUID FK → files | Which file was sent |
| patient_id | UUID FK → patients | Who it was sent to |
| session_id | UUID FK → sessions | Originating session (nullable for standalone sends in future) |
| token | Text UNIQUE | URL token for patient access: `/files/view/{token}` |
| sent_at | Timestamp | When the SMS was sent |
| viewed_at | Timestamp | When the patient first opened the link (nullable) |
| created_at | Timestamp | |

### Supabase Storage

- **Bucket:** `clinic-files` (private, not public)
- **Path convention:** `{org_id}/{file_id}.pdf`
- **Max file size:** 10 MB (enforced at the bucket level via `file_size_limit`)
- **Allowed MIME types:** `application/pdf` (enforced at the bucket level via `allowed_mime_types`)
- **Upload access:** Authenticated staff, org-scoped. Storage policies use `storage.foldername(name)` to ensure staff can only upload to their own org's folder.
- **Patient access:** Patients do NOT access storage directly. The `/api/files/view/[token]` route validates the delivery token, then generates a short-lived signed URL on demand and redirects/streams the PDF. This avoids the expiry problem of pre-generating signed URLs at delivery time — the token is permanent, the signed URL is ephemeral.

### Workflow integration

The existing `send_file` action type (already in the `action_type` enum) carries the file reference in `config`:

```jsonc
// send_file action block config
{
  "file_id": "uuid-of-the-file",
  "message": "Hi {first_name}, your clinician has shared a document with you. Tap here to view it.",
  "default_enabled": true
}
```

At Process confirmation, the `file_id` is snapshotted into `appointment_actions.config` (same snapshot discipline as SMS/form actions). The `send_file` handler:

1. Creates a `file_deliveries` row with a unique token.
2. Sends an SMS with the link `{APP_URL}/files/view/{token}`.
3. Sets action status to `sent`.

## UI Surfaces

### 1. Forms & Files page — sidebar nav rename

Rename the sidebar nav item from "Forms" to "Forms & Files". Route stays `/forms`. Same role/tier gating (practice_manager, clinic_owner, Complete tier).

### 2. Forms & Files page — tab bar

Add a tab bar at the top of the page, above the existing forms list:

| Tab | Content |
| --- | --- |
| **Forms** | Existing forms list (no changes) |
| **Files** | New file library list |

Default tab: Forms (preserves current behaviour). Tab state is local — no URL change.

### 3. Files tab — list view

**Section header:** "File library" label on the left. "+ Upload file" button (teal) on the right.

**Table columns:**

| Column | Content |
| --- | --- |
| Name | File name (weight 500) with description beneath in muted text |
| Size | Human-readable file size ("2.4 MB") |
| Uploaded | Relative date ("3 days ago") or absolute ("12 Apr 2026") |
| Actions | Archive button (trash icon). Soft-deletes — file hidden from library but existing patient links still work. |

**Empty state:** "No files uploaded yet. Upload your first PDF to share with patients via workflows." Primary button: "+ Upload file".

Row click opens a preview (future — for now, no preview on click).

### 4. Upload flow

"+ Upload file" button opens a simple modal/dialog:

1. **File picker** — drag-and-drop zone or click to browse. Accepts `.pdf` only. Max 10 MB. Shows validation error for wrong type or oversized files.
2. **Name** — text input, pre-filled from the file name (minus `.pdf` extension). Editable.
3. **Description** — optional text input. One-liner.
4. **Upload button** — uploads to Supabase Storage, creates `files` row, closes modal, refreshes list.

Progress indicator during upload. Error toast on failure.

### 5. Pathway editor — file picker

The existing "+ Add action" picker in the pathway editor (outcome-pathway-editor.tsx) already shows "SMS", "Send form", "Task". Add **"Send file"** as a fourth option.

When "Send file" is selected, the action block detail editor shows:

| Field | Behaviour |
| --- | --- |
| File picker | Dropdown of files from the org's file library. Shows file name + size. |
| SMS message | Textarea with merge fields. Pre-filled with default: "Hi {first_name}, your clinician has shared a document with you. Tap here to view it: {file_link}" |
| Timing | Same day input + quick-pick chips as other action types |

The `file_id` is stored on the action block (in `config.file_id`). At Process time, the receptionist can swap the file via the same dropdown.

### 6. Process flow — file action customisation

In the Process flow customisation timeline (process-flow-outcome.tsx), `send_file` actions render with:

- File icon + "Send file" label
- File name as the content summary
- Inline edit: file picker dropdown + SMS message textarea
- Toggle on/off (same as other action types)

### 7. Patient-facing PDF viewer

**Route:** `/files/view/[token]`

Simple page:
- Validates the `token` against `file_deliveries`. The token never expires — it's a permanent identifier for the delivery.
- Sets `viewed_at` on first access (if null).
- Server-side: generates a short-lived signed Supabase Storage URL (e.g. 60-minute expiry) on each page load. This avoids the stale-URL problem — the patient can open the link days after receiving the SMS.
- Renders the PDF inline using an `<iframe>` or `<embed>` pointing to the signed URL.
- Download button below the viewer.
- Clinic branding header (logo + name from the org).
- Mobile-friendly — 420px container on desktop, full-width on mobile.

If the token is invalid: "This link is no longer available" error page. Archived files are still viewable — archiving hides from the library, not from patients.

## Schema Changes (Migration)

```sql
-- Files table (soft-delete via archived_at)
CREATE TABLE files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organisations(id),
  name TEXT NOT NULL,
  description TEXT,
  storage_path TEXT NOT NULL,
  file_size_bytes INTEGER NOT NULL,
  mime_type TEXT NOT NULL DEFAULT 'application/pdf',
  uploaded_by UUID REFERENCES users(id),
  archived_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_files_org ON files(org_id);
CREATE INDEX idx_files_active ON files(org_id) WHERE archived_at IS NULL;

-- File deliveries (tracking sends to patients)
CREATE TABLE file_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  file_id UUID NOT NULL REFERENCES files(id),
  patient_id UUID NOT NULL REFERENCES patients(id),
  session_id UUID REFERENCES sessions(id),
  token TEXT UNIQUE NOT NULL,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  viewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_file_deliveries_token ON file_deliveries(token);
CREATE INDEX idx_file_deliveries_file ON file_deliveries(file_id);

-- ============================================================================
-- RLS: files
-- ============================================================================
ALTER TABLE files ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff can view files in their org"
  ON files FOR SELECT
  USING (org_id IN (SELECT public.user_org_ids()));

CREATE POLICY "Staff can insert files in their org"
  ON files FOR INSERT
  WITH CHECK (org_id IN (SELECT public.user_org_ids()));

CREATE POLICY "Staff can update files in their org"
  ON files FOR UPDATE
  USING (org_id IN (SELECT public.user_org_ids()));

-- No DELETE policy — files are soft-deleted via archived_at UPDATE, never hard-deleted.

-- ============================================================================
-- RLS: file_deliveries
-- file_deliveries are created by the workflow engine (service role, bypasses RLS)
-- and read by staff for tracking. Patient access goes through the /api/files/view
-- route which uses the service role client.
-- ============================================================================
ALTER TABLE file_deliveries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff can view file deliveries for files in their org"
  ON file_deliveries FOR SELECT
  USING (file_id IN (
    SELECT id FROM files WHERE org_id IN (SELECT public.user_org_ids())
  ));

-- No INSERT policy needed. file_deliveries are created exclusively by the
-- workflow engine via the service role client, which bypasses RLS entirely.

-- ============================================================================
-- Supabase Storage bucket with server-enforced constraints
-- ============================================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'clinic-files',
  'clinic-files',
  false,
  10485760,                          -- 10 MB
  ARRAY['application/pdf']::text[]   -- PDF only
);

-- Storage policies: org-scoped via folder name convention ({org_id}/{file_id}.pdf)
CREATE POLICY "Staff can upload files to their org folder"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'clinic-files'
    AND (storage.foldername(name))[1] IN (
      SELECT id::text FROM organisations
      WHERE id IN (SELECT public.user_org_ids())
    )
  );

CREATE POLICY "Staff can read files in their org folder"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'clinic-files'
    AND (storage.foldername(name))[1] IN (
      SELECT id::text FROM organisations
      WHERE id IN (SELECT public.user_org_ids())
    )
  );

CREATE POLICY "Staff can delete files in their org folder"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'clinic-files'
    AND (storage.foldername(name))[1] IN (
      SELECT id::text FROM organisations
      WHERE id IN (SELECT public.user_org_ids())
    )
  );
```

## API Routes

| Route | Method | Purpose |
| --- | --- | --- |
| `/api/files?org_id=xxx` | GET | List active files for org (`WHERE archived_at IS NULL`) |
| `/api/files` | POST | Upload file (multipart form data) → store in bucket, create `files` row |
| `/api/files?id=xxx` | DELETE | Soft-delete: set `archived_at = now()`. Storage object preserved for existing delivery links. |
| `/api/files/view/[token]` | GET | Patient-facing: validate delivery token, generate short-lived signed URL on demand, redirect or stream PDF |

## Affected Files

| File | Change |
| --- | --- |
| `supabase/migrations/017_files_library.sql` | New migration: files table, file_deliveries table, storage bucket, RLS |
| `src/app/api/files/route.ts` | New: GET (list), POST (upload), DELETE |
| `src/app/(patient)/files/view/[token]/page.tsx` | New: patient-facing PDF viewer |
| `src/components/clinic/sidebar.tsx` | Rename "Forms" → "Forms & Files" |
| `src/components/clinic/forms-shell.tsx` | Add tab bar (Forms / Files), render FilesPanel when Files tab active |
| `src/components/clinic/files-panel.tsx` | New: file list table + upload modal |
| `src/components/clinic/outcome-pathway-editor.tsx` | Add "Send file" to action picker, file picker in block detail editor |
| `src/components/clinic/process-flow-outcome.tsx` | Add file picker for send_file action customisation |
| `src/lib/workflows/handlers.ts` | Implement `handleSendFile()`: create file_delivery, send SMS with link |
| `src/lib/workflows/types.ts` | No changes needed — `send_file` already in ACTION_TYPE_META with `hasFile: true` |
| `src/stores/clinic-store.ts` | Add `files` slice (list of FileRow) to the store |

## Seed Data

Seed 4 PDFs from `files/` directory into the `clinic-files` bucket and `files` table for the demo org:

- "Depression Fact Sheet" — `07-Depression-headspace-fact-sheet-WEB.pdf`
- "ADHD Fact Sheet for Educators" — `ADHD-Guideline-Factsheet-ADHD-Factsheet-For-Educators-C-AADPA.pdf`
- "Causes of Bipolar Disorder" — `Causes-of-bipolar-disorder.pdf`
- "Signs and Symptoms of Anxiety" — `Signs-and-Symptoms-of-Anxiety-fact-sheet.pdf`

## Decisions

| Decision | Choice | Rationale |
| --- | --- | --- |
| File scope | Org-level library | Shared across all locations and clinicians. Simple. |
| Lifecycle | No draft/publish — live on upload | Files don't need review. A PDF is a PDF. |
| Deletion | Soft delete (`archived_at`) | FK constraint from `file_deliveries` blocks hard delete. Archived files stay in storage so existing patient links continue to work. |
| File types | PDF only (v1) | Covers the clinical use case. Images/docs can be added later. Enforced at bucket level. |
| Size limit | 10 MB | Generous for PDFs, prevents abuse. Enforced at bucket level. |
| Patient access | Permanent delivery token, on-demand signed URL | Token in SMS never expires. Signed URL generated fresh on each page load (short expiry). Avoids stale URL problem. |
| Storage security | Org-scoped via `storage.foldername` | Prevents cross-org access. Staff can only read/write their org's folder. |
| Storage | Supabase Storage (private bucket) | Follows existing org-logos pattern. No public read. |
| Delivery tracking | `file_deliveries` table with `viewed_at` | Lightweight analytics. Know if the patient opened it. |
| file_deliveries RLS | Service role writes, staff reads | Workflow engine creates deliveries via service role (bypasses RLS). Staff can view deliveries for files in their org. |
| Categories/tags | Not in v1 | Premature. Small file libraries don't need taxonomy. |
| Standalone sends | Not in v1 | Files only sent via workflow engine for now. |
