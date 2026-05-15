# Refactor: File structure and oversized files

**Status:** Proposed
**Goal:** Reduce friction reading and changing the codebase. Files should be small enough to hold in your head, directories should reflect features not types, and patterns that are hand-rolled three times should live in one place.

## Why now

The prototype is hitting the size where structural debt starts costing more than it saves. Top files:

| Path | Lines |
|---|---:|
| `src/lib/supabase/types.ts` | 1656 |
| `src/components/clinic/readiness-shell.tsx` | 1116 |
| `src/components/patient/intake-journey.tsx` | 918 |
| `src/components/clinic/patient-contact-card.tsx` | 830 |
| `src/stores/clinic-store.ts` | 743 |
| `src/components/clinic/outcome-pathway-editor.tsx` | 663 |
| `src/components/clinic/process-flow-outcome.tsx` | 653 |
| `src/components/clinic/appointment-type-editor.tsx` | 651 |

And `src/components/clinic/` has 57 sibling files at one directory level — feature ownership isn't visible from the tree.

This isn't about hitting a line-count target. It's about: which files do you have to scroll-and-grep to understand, and which moves would actually help.

## Non-goals

- No introduction of new state libraries, dependency injection, or "clean architecture" layering. Move what exists; don't replace it.
- No splitting for the sake of splitting. A 400-line file with one clear responsibility stays.
- No renaming spree. Move + import-rewrite only. Rename only when a name is genuinely wrong (e.g. `readiness-shell.tsx` owns more than readiness).
- No test additions in this plan. Test coverage is a separate question.
- No move that fights Next.js App Router conventions (`app/` stays exactly as it is).

## What to refactor (ranked by payoff per unit risk)

### 1. Isolate generated Supabase types — `very low risk`, `high clarity gain`

`src/lib/supabase/types.ts` (1656 lines) is entirely Supabase-generated, but it sits next to hand-written modules with no visual signal that it's read-only. New contributors are one bad edit away from a regenerate that silently wipes their changes.

**Move:**
- Move the generated content to `src/lib/supabase/database.generated.ts`. The `.generated.ts` suffix is a widely-recognised "do not edit" signal and survives codegen rewrites. The signal lives in the filename — do not add a header comment, because the codegen script overwrites the file wholesale and will strip it on next regenerate.
- Keep `src/lib/supabase/types.ts` as a thin public barrel that re-exports `Database` (and the derived helpers) from `database.generated.ts`. Most consumers don't move — they already import from `@/lib/supabase/types`.
- Update `src/lib/supabase/custom-types.ts` (it currently imports `Database` from `./types`) to import from `./database.generated` directly. That's the only internal consumer that needs to change.
- **Add a codegen script** to `package.json` that targets `src/lib/supabase/database.generated.ts`:
  ```json
  "supabase:gen": "supabase gen types typescript --linked > src/lib/supabase/database.generated.ts"
  ```
  Without this, the next `supabase gen types` run will overwrite the wrong file and re-create the old problem. If a header comment really is wanted later, do it via a small generation script that appends after `supabase gen types`, not by editing the generated file.

**Risk:** Very low. Because `types.ts` becomes a barrel, the public import path doesn't change for ~all consumers. Audit: `grep -rn "from .*supabase/types"` should show ~no churn beyond `custom-types.ts`.

### 2. Group `src/components/clinic/` by feature — `low risk, high churn`, `high navigation gain`

57 files in one directory. The current names already disclose grouping (`process-flow-*.tsx`, `runsheet-*.tsx`, `readiness-*.tsx`, `workflow-*.tsx`, `*-settings-shell.tsx`, `*-panel.tsx`), but you have to fuzzy-search to find anything.

Behaviourally low risk — pure moves — but touches many imports, including paths inside `next/dynamic(() => import(...))` callbacks in `runsheet-shell.tsx` and `readiness-shell.tsx` that won't be caught by a TypeScript pass on rename-without-edit. Build verification is non-negotiable; a tsc-clean PR can still break a dynamic-import path at runtime.

**Move into feature subdirectories:**

```
src/components/clinic/
├── runsheet/
│   ├── runsheet-shell.tsx
│   ├── runsheet-header.tsx
│   ├── runsheet-skeleton.tsx
│   ├── room-container.tsx
│   ├── room-container-skeleton.tsx
│   ├── session-row.tsx
│   ├── session-row-skeleton.tsx
│   ├── summary-bar.tsx
│   ├── add-session-panel.tsx
│   ├── video-call-panel.tsx
│   └── action-button.tsx              # sole caller is session-row
├── readiness/
│   ├── readiness-shell.tsx
│   ├── readiness-filter-bar.tsx
│   └── readiness-mode-toggle.tsx
├── process-flow/
│   ├── process-flow.tsx
│   ├── process-flow-outcome.tsx
│   ├── process-flow-payment.tsx
│   └── process-flow-done.tsx
├── workflows/
│   ├── workflows-shell.tsx
│   ├── workflow-editor.tsx
│   ├── workflow-middle-pane.tsx
│   ├── workflow-sidebar.tsx
│   ├── outcome-pathway-editor.tsx
│   ├── outcome-pathways-panel.tsx
│   ├── action-card.tsx
│   ├── add-action-popover.tsx
│   ├── fire-time-picker.tsx
│   └── precondition-picker.tsx
├── forms/
│   ├── forms-shell.tsx
│   ├── form-builder-shell.tsx
│   ├── form-builder-wrapper.tsx
│   ├── form-assignments-panel.tsx
│   ├── form-handoff-panel.tsx
│   ├── intake-package-handoff-panel.tsx
│   ├── standalone-submission-panel.tsx
│   └── files-panel.tsx                # sole caller is forms-shell
├── settings/
│   ├── appointment-type-editor.tsx
│   ├── appointment-types-settings-shell.tsx
│   ├── payments-settings-shell.tsx
│   ├── rooms-settings-shell.tsx
│   └── room-form-panel.tsx
├── patient/
│   ├── patient-contact-card.tsx
│   ├── patient-name-link.tsx
│   ├── patient-slide-over-context.tsx
│   ├── add-patient-panel.tsx
│   └── modality-badge.tsx
├── onboarding/
│   ├── onboarding-coach-mark.tsx
│   └── onboarding-overlay.tsx
└── shared/
    ├── action-type-icon.tsx            # used by workflows, readiness, patient-contact-card
    ├── status-badge.tsx                # used by runsheet (session-row) and patient-contact-card
    ├── clinic-data-provider.tsx
    ├── connection-indicator.tsx
    ├── dev-role-switcher.tsx
    ├── location-switcher.tsx
    ├── mid-flight-warning-modal.tsx
    ├── providers.tsx
    ├── sidebar.tsx
    ├── sidebar-nav-item.tsx
    ├── sidebar-user-section.tsx
    └── top-bar.tsx
```

**Three judgment calls baked into this:**
- **No `panels/` directory.** Slide-over panels live with their feature (add-session-panel with runsheet, form-handoff-panel with forms). Grouping by component shape (panels, shells, rows) instead of feature is the same mistake as grouping by file type.
- **No single-file feature directories.** `files-panel.tsx` does not get its own `files/` directory unless Files becomes a real feature area with multiple modules. Until then it lives with `forms/` (its current callers) or `shared/`. The same principle applies anywhere else a directory would hold one file forever.
- **`shared/` is the catch-all for things that genuinely span features** (sidebar, providers, dev tooling). Resist the urge to fill it.

**Import convention to set with this PR:**
- **Relative imports within a feature directory** (`./session-row` from `runsheet-shell.tsx`).
- **Absolute imports for cross-feature** (`@/components/clinic/patient/patient-name-link` from a runsheet file).
- **No barrel `index.ts` exports** unless they are deliberately preserving a public import path (the only candidate is `patient-contact-card/index.tsx` in #3 below, where the path *is* the public API).

**Also fix during the move (small but worth doing inline):** `room-form-panel.tsx:7` imports `RoomWithClinicians` from `rooms-settings-shell.tsx`, which itself re-exports it from the store. Components shouldn't be type barrels. While settings files are moving, change the import to `@/stores/clinic-store` (or `@/stores/clinic/types` if #7 has landed). Same principle: hunt for any other type re-exports through component files while reorganising.

**Risk:** Low behaviourally. High *mechanical* churn — touches almost every clinic-side import. Do this as one mechanical PR with `git mv` so blame survives. The mass import rewrite is the only painful part — use a codemod or `sed -i` pass, not by hand.

`tsc --noEmit` clean is necessary but not sufficient — `next build` is the real gate. Webpack/Turbopack does resolve the module strings inside `dynamic(() => import(...))`, so a stale path will fail the build, but it's still easy to miss in a manual sweep. Run `next build` and also grep for surviving string literals matching old paths inside `dynamic(() => import(...))` calls before opening the PR.

**Decide before moving** (don't preserve arbitrary locations through the move):
- `call-dropdown.tsx` currently has **zero callers** in the codebase. Either delete as dead code or restore a real call site before deciding a home. Don't migrate it to `patient/` just because it ended up there in the original tree.
- Any other unused exports that fall out of the grep audit get the same treatment: delete, don't migrate.

### 3. Decompose `patient-contact-card.tsx` — `medium risk`, `high readability gain`

830 lines. Owns five distinct sections (demographics, phone numbers, payment methods, appointments table, form assignments + submissions) plus a readiness-specific mode switched on by an optional `appointment` prop. Inline interfaces for `AppointmentRow`, `FormAssignmentRow`, etc.

**Move (under the new `clinic/patient/` directory from #2):**

```
src/components/clinic/patient/patient-contact-card/
├── index.tsx                       # slim shell: layout, slide-over, section orchestration
├── demographics-section.tsx        # name, DOB, phones, cards
├── appointments-section.tsx        # appointment table + bucketing
├── forms-section.tsx               # assignments + submissions + completed
├── readiness-actions.tsx           # onDeleted flow (readiness mode only)
└── types.ts                        # pull the 5+ inline interfaces here
```

**Risk:** Medium. High-traffic component opened from readiness, run sheet patient links, and patient slide-over context. Visual regressions matter. The split is mechanical but verify both modes (`appointment` present vs. absent) after.

### 4. Decompose `readiness-shell.tsx` — `low risk`, `high readability gain`

1116 lines. Owns: top filter bar wiring, pre/post mode toggle, paginated table, two row renderers (`PatientRow`, `StandaloneSubmissionRow`, ~280 lines each), modal orchestration, plus a handful of date helpers.

**Move (inside the new `clinic/readiness/` directory):**

```
src/components/clinic/readiness/
├── readiness-shell.tsx          # slim: tab + filter wiring + modal state
├── readiness-table.tsx          # pagination shell + header
├── patient-row.tsx              # the appointment row + its expanded view
├── standalone-submission-row.tsx
├── utils.ts                     # formatDateTime, relativeTime, etc.
└── types.ts                     # ActivePanel, ReadinessPriority, ...
```

**Risk:** Low. Each row is largely self-contained; props are the only contract. Test modal open/close, the active-panel switcher, and pagination after split.

### 5. De-duplicate workflow editors via shared block-list component — `medium risk`, `medium gain`

The plan originally said three editors share the duplicate pattern. Verifying against the code:

- `outcome-pathway-editor.tsx:47` — local `function ActionTypeIcon(...)`. **Duplicate.**
- `process-flow-outcome.tsx:62` — local `function ActionTypeIcon(...)`. **Duplicate.**
- `appointment-type-editor.tsx` — **no local `ActionTypeIcon`.** It configures pre-appointment workflow blocks but doesn't reimplement the icon. Different surface from the post-appointment editors.

A perfectly good `action-type-icon.tsx` (109 lines) already exists and neither of the two duplicates uses it.

**Two parts:**

**5a. Trivial: drop the two local `ActionTypeIcon` reimplementations in `outcome-pathway-editor.tsx` and `process-flow-outcome.tsx`; import from the canonical `action-type-icon.tsx`.** ~20 min, zero risk. Worth doing first as a warm-up.

**5b. Substantive: spike before committing.** Before extracting a shared `<ActionBlockList />` + `<ActionBlockItem />`:
- Read the two post-appointment editors (`outcome-pathway-editor.tsx`, `process-flow-outcome.tsx`) side by side and confirm the block list semantics genuinely match (add/delete/reorder/customise + per-block config).
- Decide whether `appointment-type-editor.tsx` belongs in the abstraction or not. It manages a pre-appointment block list which may or may not share the same shape — the surface differs (intake package + reminders config vs. post-appointment outcome flow). If forcing all three through one component fights the natural shape, leave it out.

If the spike confirms a clean abstraction across at least two editors, extract to `clinic/workflows/shared/`. If it's forcing the model, drop 5b and accept the duplication.

**Risk:** Medium for 5b. These editors are active save paths — block save/load and validation behaviour must be preserved exactly. 5a ships independently of 5b.

### 6. Slice the Zustand store by domain — `medium-high risk`, `medium gain`

`src/stores/clinic-store.ts` (743 lines) is a kitchen-sink store. The current tiered comments (Tier 1 stable / Tier 2 volatile / Tier 3 realtime) describe access patterns, not domains. Finding readiness logic means scanning the file; same for payments, forms, workflows.

**Why this is last.** The file is not just state. It bundles:

- 12+ exported domain row interfaces (`FormRow`, `FileRow`, `OutcomePathwayRow`, `ReadinessAppointment`, etc.) that components import directly from `@/stores/clinic-store`, treating the store as a type barrel.
- Async refresh actions with stale-response guards (every `refresh*` checks `get().locationId !== locationId` before writing).
- Realtime merge behaviour (`mergeSessionUpdate`).
- Per-slice loaded flags and fetched-at timestamps wired into the cold-load gate and the socket connect handler's freshness window.

Slicing all of that at once invites circular-import pain and the kind of subtle bug that only shows up under a specific reconnect-during-location-switch sequence. The file is at least readable today — defer until everything else is done.

**Sequenced approach:**

**6a. Type extraction first (do during #2 or right after).** Move the 12+ exported row interfaces from `clinic-store.ts` to `src/stores/clinic/types.ts`. The store re-exports them from `types.ts` so no external import changes. This is mechanical and unblocks everything that follows, including #4 and #3 if they want a typed home for inline interfaces.

**6b. Behaviour slicing (the real work).** Only after 6a settles:

```
src/stores/
├── clinic-store.ts                # composes slices, re-exports useClinicStore/getClinicStore
└── clinic/
    ├── types.ts                   # all Row interfaces (already moved in 6a)
    ├── sessions-slice.ts          # sessions, connectedSessions, sessionsFetchedAt
    ├── rooms-slice.ts             # rooms, roomsWithClinicians, clinicianRoomIds
    ├── readiness-slice.ts         # readinessAppointmentsPre/Post, counts, direction
    ├── forms-slice.ts             # forms, files, standaloneSubmissions
    ├── workflows-slice.ts         # appointmentTypes, outcomePathways, pre/post templates+blocks
    ├── payments-slice.ts          # paymentConfig, paymentRooms
    └── onboarding-slice.ts        # onboarding, onboardingLoaded
```

**Key constraint:** keep `useClinicStore` and `getClinicStore` as the only entry points. Slicing is an internal refactor; nothing outside the store module changes its import. Cross-slice access (`resetLocationData` resets multiple slices) goes through the composed store, not slice-to-slice imports — that's where circular imports come from.

**Risk:** Medium-high. The store is referenced from every page and most hooks. Test:
- Location switch (`resetLocationData` clears the right slices and nothing else).
- Cold load (per-slice loaded flags flip in isolation; the run sheet structural-loading gate still works).
- Realtime session updates (`mergeSessionUpdate` still touches the right slice).
- The freshness-windowed resync logic in `clinic-data-provider.tsx:44-80` (`sessionsFetchedAt`, `readinessFetchedAt` still readable after slicing).

## What I considered and rejected

- **Splitting `intake-journey.tsx` (918 lines).** It looks like a step-machine; splitting per step is tempting but state lives at the top level. Defer until the patient-side intake flow is touched for a feature change — then split it in that PR.
- **Pulling all "panel" components into a `panels/` directory.** Groups by shape, not feature. Resisting.
- **A `lib/api/<domain>/` handler extraction for multi-action API routes** (payments PATCH switch, workflows POST switch, etc.). Real pattern, but the routes that have it are 200-300 lines — not painful enough to justify a layer.
- **A `hooks/` reorganisation.** The hook count is fine; the directory is shallow.
- **Renaming `readiness-shell.tsx` to reflect what it owns.** Tempting but invites bikeshedding. Decomposition (#4) makes the name accurate by removing what doesn't belong.

## Execution order

This is the order I'd ship them in. Each is independently mergeable.

1. **1 — Move generated types to `database.generated.ts`.** Very low risk; barrel keeps consumer imports stable. Adds the codegen script. Useful for everyone immediately.
2. **5a — Drop the two duplicate `ActionTypeIcon` implementations** (`outcome-pathway-editor.tsx`, `process-flow-outcome.tsx`) in favour of the canonical `action-type-icon.tsx`. ~20 min, zero risk.
3. **2 — Group `src/components/clinic/` by feature.** Single mechanical PR; the import convention (relative within / absolute across / no barrels) is set here. After this, every later refactor has a sensible home.
4. **4 — Decompose `readiness-shell.tsx`.** Self-contained; the new structure from #2 is the target.
5. **3 — Decompose `patient-contact-card.tsx`.** Higher visual-regression risk than #4; do after.
6. **5b — Spike + maybe extract shared block-list editor component.** Spike first; if the abstraction is forced, drop and accept the duplication.
7. **6a — Move store row interfaces to `src/stores/clinic/types.ts`.** Mechanical; types re-exported from the store so consumers don't change.
8. **6b — Slice store behaviour by domain.** Last because it's the riskiest and the file is at least readable today.

## Verification per PR

- `npm run typecheck` clean (add the script if not present: `"typecheck": "tsc --noEmit"`). Currently `package.json` only has `dev`, `build`, `start`, `lint` — this plan assumes typecheck is one command, not "remember to run `npx tsc --noEmit`."
- `npm run build` clean. Webpack/Turbopack resolves `dynamic(() => import(...))` module strings, so a stale path fails the build — this is the gate that tsc alone misses for #2.
- For UI moves (#3, #4): manual smoke of the affected page in a browser. Specifically named test cases:
  - **#4:** load `/readiness` in pre and post modes, open one patient row, open one standalone submission row, paginate, open and close each modal sub-panel.
  - **#3:** open patient contact card from the run sheet, from readiness (with `appointment` prop), and from the patient slide-over context. Each section renders. Delete flow works in readiness mode.
- For #6: hard-test location switch, cold load, and a forced socket reconnect.

## Out of scope

- Test suite. Refactor-without-tests is the working assumption for this prototype.
- API route refactors. The big API routes (`api/patient/[id]/route.ts`, `api/forms/standalone/[public_token]/submit/route.ts`) carry genuine business logic; their size is content, not structure.
- Workflow engine (`lib/workflows/*`). The 518-line `handlers.ts` and 475-line `engine.ts` are domain-dense but not structurally muddled.
