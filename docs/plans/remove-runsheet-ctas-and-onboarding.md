# Plan: Remove Nudge/Call run sheet CTAs + disable onboarding experience

**Branch:** `refactor/file-structure` (or a new branch off it)
**Date:** 2026-05-27

## Goals

1. Remove the **Nudge** and **Call** call-to-action buttons from the run sheet — both
   the per-row action buttons and the bulk variants in the header/summary bar.
2. **Disable the onboarding experience** in a way that is trivial to switch back on.
   Per your decision: comment out the mount points (don't delete files). All
   onboarding code, API routes, store slice, and DB columns stay in place; re-enabling
   is "uncomment two lines."

---

## Part 1 — Remove Nudge & Call run sheet CTAs

### Background (what's actually wired today)

- **Per-row buttons:** `getActionConfig()` in `src/lib/runsheet/derived-state.ts` maps
  the `late` derived state → a red **Call** button (`action: 'call'`) and the `upcoming`
  state → an amber **Nudge** button (`action: 'nudge'`). These render via
  `action-button.tsx` inside each `session-row.tsx`.
- **Bulk buttons:** `runsheet-header.tsx` and `summary-bar.tsx` both render bulk
  **"Call now (n)"** and **"Nudge (n)"** buttons. Note: `runsheet-shell.tsx` never passes
  `onBulkCall` / `onBulkNudge`, so these bulk buttons are **already dead clicks today** —
  they render but do nothing. Removing them is pure cleanup with no behaviour loss.
- **Handlers:** `callPatient()` and `nudgePatient()` live in `src/lib/runsheet/actions.ts`,
  and `runsheet-shell.tsx` dispatches them in `handleAction()`.

### Changes

**1.1 — `src/lib/runsheet/derived-state.ts` (the key change)**
- In `getActionConfig()`, remove the `case 'late':` (Call) and `case 'upcoming':` (Nudge)
  branches so they fall through to `return null` (no action button).
- This alone removes both per-row buttons. The status pills/colours for `late` and
  `upcoming` (from `getStatusConfig`) are untouched — rows still show as red/amber, they
  just no longer offer an action button.

**1.2 — `src/components/clinic/runsheet/runsheet-header.tsx`**
- Remove the `hasUpcoming` "Nudge (n)" button block (lines ~87–91) and the `hasLate`
  "Call now (n)" button block (lines ~92–96).
- Remove the now-unused `onBulkCall` / `onBulkNudge` props from the interface and the
  destructure.
- Keep `hasLate` / `hasUpcoming` — still needed for `boltColor`. **Split `hasActions` into
  two values** (it currently drives both the Zap fill at line 58 and the add-session
  divider at line 97, and those need different inputs now):
  - `hasAttention = hasLate || hasUpcoming || hasComplete` → drives the Zap `fill` so the
    bolt still fills for late/upcoming states (preserve current behaviour).
  - `hasBulkActions = hasComplete` → drives the "+ Add session" divider, since only Bulk
    process remains as a bulk button.
  - Update line 58 `fill={hasActions ? ...}` → `hasAttention`, and line 97
    `{showAddButton && hasActions && <divider>}` → `hasBulkActions`.
  - (Verify the divider still looks right when only Bulk process is present.)

**1.3 — `src/components/clinic/runsheet/summary-bar.tsx`**
- Remove the `summary.late` "Call now (n)" block and the `summary.upcoming` "Nudge (n)"
  block.
- Remove the unused `onBulkCall` / `onBulkNudge` props.
- Recompute `hasActions` to depend on `summary.complete` only.
- (Note: confirm whether `summary-bar.tsx` is actually mounted anywhere — research
  suggests the header carries the bulk actions in the current build. If `SummaryBar` is
  unused/dead, flag it but still clean it up for consistency.)

**1.4 — `src/components/clinic/runsheet/runsheet-shell.tsx`**
- In `handleAction()`, remove the `case "call":` and `case "nudge":` branches.
- Drop `callPatient` and `nudgePatient` from the dynamic `import("@/lib/runsheet/actions")`
  destructure (keep `admitPatient`).

**1.5 — `src/lib/runsheet/actions.ts`** (decision point — see Open Questions)
- Default: **leave `callPatient()` and `nudgePatient()` in place but unreferenced.** They're
  harmless, and `nudgePatient()` is real SMS logic you may want back. Lint may warn about
  unused exports depending on config — if it errors the build, either delete them or add the
  standard ignore. Recommend keeping them.

**1.6 — Types**
- `ActionConfig.action` union in `src/lib/supabase/custom-types.ts` still lists
  `'call' | 'nudge'`. Leave the union as-is (no longer produced, but harmless and keeps the
  handlers/diff small). Optional tidy-up only.

### Behaviour after Part 1
- `late` rows: red status pill, **no** action button.
- `upcoming` rows: amber status pill, **no** action button.
- Header/summary bar: only **Bulk process (n)** remains as a bulk action.
- `admit` / `process` / `rejoin` actions unchanged.

---

## Part 2 — Disable the onboarding experience (reversible)

Onboarding is a self-contained "first-login walkthrough" for clinic staff: an overlay
modal → coach marks → a generated demo patient/session/form, with demo tooltips on the
patient intake side. It is **distinct from** the clinic `setup` flow and the patient
`entry` flow — neither of those is touched.

### Approach (per your choice: comment out the mounts)

The experience is *entered* only through two mounts in `runsheet-shell.tsx`. Commenting
them out stops the **normal creation of new demo sessions** (the overlay's button is the
only UI that POSTs to `/api/onboarding/test-session`).

**Scope caveat (important):** "comment out the mounts" disables onboarding *going forward
for new sessions*, but it is **not** a guarantee of "no onboarding anywhere":
- Any **existing** rows with `is_onboarding_demo = true` (from prior testing) still exist,
  and their patient intake/waiting links will **still show the demo tooltips**, because the
  patient side reads the flag off the row, independent of the clinic mounts.
- `/api/onboarding/test-session` is **still callable directly** (it just has no button).

The single gate for all four patient-side tooltips is `isDemo` at
`src/components/patient/intake-journey.tsx:114`
(`journey.is_onboarding_demo && !journey.status.includes('completed')`).

**Decision for you (see Open Questions #4):**
- **(a) Minimal / "no new onboarding"** — comment the two mounts only. Existing demo
  links remain demo-flavoured. Fine if there's no real demo data in the target DB.
- **(b) Hard "no onboarding anywhere"** — additionally force `isDemo = false` at
  `intake-journey.tsx:114` (one-line gate, e.g. `const isDemo = false;` with a marker
  comment) and optionally early-return a 404/disabled response from
  `/api/onboarding/test-session/route.ts`. This neutralises existing demo rows and the
  direct API too.

The rest of this section describes approach (a); (b) is the same plus those two extra
gates.

I'll make it a single clearly-marked block rather than scattered comments, so re-enabling
is obvious.

**2.1 — `src/components/clinic/runsheet/runsheet-shell.tsx`**
- Comment out the two mounts (lines ~368–369) with a marker:
  ```tsx
  {/* ONBOARDING DISABLED — uncomment these two lines to re-enable the
      first-login walkthrough. See docs/plans/remove-runsheet-ctas-and-onboarding.md */}
  {/* <OnboardingOverlay /> */}
  {/* <OnboardingCoachMark /> */}
  ```
- Optionally skip the `/api/onboarding/state` fetch effect (lines ~115–131) while disabled
  to avoid a pointless network call on every run sheet load. Lowest-risk option: leave the
  fetch (it's swallowed on failure and harmless), and only comment the mounts. **Recommend
  leaving the fetch** to keep the toggle to exactly two lines.
- **Unused-import caveat (verified):** with the JSX commented, the `OnboardingOverlay` /
  `OnboardingCoachMark` imports (lines 17–18) become unused. ESLint here extends
  `eslint-config-next/typescript`, so `@typescript-eslint/no-unused-vars` is a **warning,
  not an error**, and tsconfig sets neither `noUnusedLocals` nor `noUnusedParameters` — so
  this **will not fail typecheck or `next build`**, but it **will dirty lint output** with
  two warnings. Also note commented JSX is not type-checked until restored, so a future
  rename could silently break the "uncomment to re-enable" promise.
  - **Recommended:** keep the imports but add `// eslint-disable-next-line @typescript-eslint/no-unused-vars`
    above each, with a comment pointing at this plan, so re-enabling stays a clean two-line
    uncomment and lint stays clean. (This is why the toggle is realistically ~4 lines, not 2.)

**2.2 — Everything else stays untouched:**
- `src/components/clinic/onboarding/*` — kept.
- `src/app/api/onboarding/*` — kept (unreachable in normal use once the overlay button is
  gone, but harmless).
- Store slice (`onboarding`, `onboardingLoaded`, `setOnboarding`, `resetOnboarding`) — kept.
  `resetOnboarding()` on logout stays; no-op effect.
- `intake-journey.tsx` / `waiting-room.tsx` demo tooltips — kept; dormant for **new**
  sessions, but still live for any **existing** `is_onboarding_demo` rows unless you pick
  hardening option (b) above.
- DB migration `019_onboarding.sql` and its columns — kept, unused.
- The onboarding-stage advancement calls inside `handleAction` / video panel close
  (`advanceOnboardingStage`) — kept. They're guarded by
  `onboarding.testSessionId === sessionId`, which never matches without a demo session, so
  they're inert.

### To re-enable later
Uncomment the two `<Onboarding* />` lines (and drop the two eslint-disable comments) in
`runsheet-shell.tsx` — and, if you took hardening option (b), restore the real `isDemo`
expression and the `test-session` route. So realistically a ~4-line revert for (a), a few
more for (b).

> If you'd prefer a sturdier switch than commented JSX (e.g. a
> `NEXT_PUBLIC_ENABLE_ONBOARDING` env flag so it can be toggled per-environment without a
> code edit), say the word — it's a small addition and matches the existing env-var
> convention in this repo. Going with comment-out as you selected.

---

## Files touched

| File | Part | Change |
|------|------|--------|
| `src/lib/runsheet/derived-state.ts` | 1 | Drop `late`→Call and `upcoming`→Nudge from `getActionConfig` |
| `src/components/clinic/runsheet/runsheet-header.tsx` | 1 | Remove bulk Nudge/Call buttons + props |
| `src/components/clinic/runsheet/summary-bar.tsx` | 1 | Remove bulk Nudge/Call buttons + props |
| `src/components/clinic/runsheet/runsheet-shell.tsx` | 1 + 2 | Drop call/nudge dispatch + import; comment out onboarding mounts |
| `src/lib/runsheet/actions.ts` | 1 | (Optional) leave `callPatient`/`nudgePatient` unreferenced |

No DB changes. No file deletions.

---

## Verification

1. `npm run build` (or `tsc --noEmit` + `npm run lint`) — confirm no type/lint errors from
   removed props, dropped switch cases, and commented imports.
2. Run sheet manual check:
   - A `late` session shows red status, **no** Call button.
   - An `upcoming` session shows amber status, **no** Nudge button.
   - Header shows only **Bulk process** when complete sessions exist; layout/divider intact.
   - `admit`, `process`, `rejoin` still work.
3. Onboarding: fresh login on a `not_started` user → **no** overlay/coach mark appears, run
   sheet loads normally. Logout still works (no console errors from `resetOnboarding`).
4. Patient entry/intake flow still works normally (no demo tooltips, which is expected).

---

## Open questions / decisions

1. **Keep or delete `callPatient`/`nudgePatient` handlers?** Recommend keep (harmless,
   `nudgePatient` is real SMS logic worth retaining). Confirm.
2. **Skip the `/api/onboarding/state` fetch while disabled?** Recommend leave it (keeps the
   toggle to two lines). Confirm if you'd rather also comment the fetch effect.
3. **`summary-bar.tsx` — is it mounted anywhere?** Confirmed unused (`rg` finds no imports
   outside the file itself). Will clean it up for consistency regardless; safe to skip if
   you'd rather not touch dead code.
4. **Onboarding scope — option (a) "no new onboarding" or (b) "none anywhere"?**
   **RESOLVED → option (a).** DB checked 2026-05-27 via Supabase REST: `sessions` with
   `is_onboarding_demo = true` = **0**. Since the patient-side demo gate (`isDemo` at
   `intake-journey.tsx:114`) and the waiting-room flag both derive `is_onboarding_demo`
   from the linked session row (`resolve-journey.ts:104`), zero demo sessions means there
   are no live demo intake/waiting links to surface tooltips. So commenting the two mounts
   fully achieves "no onboarding anywhere" today. (For reference: 1 `forms.is_platform_demo`
   row and 8 users with non-default `onboarding_stage` exist — both inert once the mounts
   are off.) Residual: `/api/onboarding/test-session` stays directly callable, so a future
   manual hit could create a new demo session; not gated under (a). Revisit (b) if that
   becomes a concern.
