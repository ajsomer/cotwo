# Workflows page: tabbed restructure and visual treatment

**Date:** 2026-04-14

## What changed

Restructured the Workflows page from a pill toggle to a tabbed pre/post-appointment layout, rebuilt the pre-appointment tab with split tables and visual polish, and iterated through several rounds of spacing and colour refinement.

### Tabbed page structure

- Replaced the pre/post-appointment pill toggle in the page header with underline-style tabs below the header. Pre-appointment is the default active tab.
- Post-appointment tab now renders a "coming soon" placeholder. The existing post-appointment editor code (sidebar, middle pane, mid-flight warning modal) is retained but not rendered. Imports commented out, handler functions left in place for the follow-up spec.

### Pre-appointment tab: split tables

- The single appointment types table that mixed run_sheet and collection_only types is now split into two sections:
  - **Appointment types table** (5 columns): filters to `terminal_type !== 'collection_only'`. Columns: name, actions, duration, modality, status.
  - **Standalone collections table** (3 columns): filters to `terminal_type === 'collection_only'`. Columns: name, actions, status.
- Each section has a label + italic explainer + action button header row. Buttons vertically centred against the text block.
- Removed the filter row (search, source, status dropdowns) as premature at current scale.
- Removed the unconfigured warning banner.

### Appointment type editor changes

- Added `forceTerminalType` prop. Terminal type is determined by which button the user clicked ("+  New appointment type" hardcodes `run_sheet`, "+ New collection" hardcodes `collection_only`).
- Removed the "On completion" collapsible section entirely. Terminal type is no longer user-editable.
- Editor title and save button text adapt for collections vs appointment types.

### Visual treatment (multiple iterations)

- **Modality pills**: telehealth stays green (#E1F5EE / #085041), in-person uses amber (#FAEEDA / #854F0B). 11px, 3px/10px padding, 10px radius, weight 500.
- **Status column**: "Idle" replaced with em dash (—) in muted grey. Active runs show "X in flight ↗" in amber (#BA7517) with dotted underline and cursor pointer. Active rows get a subtle #FFFDF8 background tint.
- **Column layout**: `grid-cols-5` / `grid-cols-3` for equal-width columns. Earlier attempts with custom fr ratios, minmax, and flexbox all produced uneven gaps.
- **Colour system**: settled on standard design system tokens (bg-gray-50 page, bg-white tables, border-gray-200 table borders, border-gray-100 row dividers). Removed all custom warm hex colours (#FBF6EF, #E8DFCF, #F0E8D6, #FDFBF6) that created a four-tone problem. Page now matches the runsheet and other clinic pages.
- **Table headers**: white background (matching data rows), distinguished by 11px muted text with letter-spacing, and a border-gray-200 bottom border (stronger than the border-gray-100 row dividers).

### Seed data

- Updated appointment type names to sentence case: "Initial consultation", "Follow-up consultation", "Brief check-in", "Review appointment", "Telehealth consultation", "Collect referral".
- Added two new seed appointment types (Telehealth consultation, Collect referral) to match the running prototype data.
- Confirmed the editor does not force Title Case on save.

## Files changed

| File | Change |
|------|--------|
| `src/components/clinic/workflows-shell.tsx` | Tab bar, post-appointment placeholder, cream background removed |
| `src/components/clinic/appointment-types-settings-shell.tsx` | Full rewrite: split tables, visual treatment, standard tokens |
| `src/components/clinic/appointment-type-editor.tsx` | `forceTerminalType` prop, removed On completion section |
| `supabase/seed.sql` | Sentence case names, two new appointment types |
| `docs/plans/workflows-tabbed-restructure.md` | Implementation spec |

## Lessons learned

- Equal-width grid columns (`grid-cols-N`) are the right default for tables. Custom fr ratios and minmax create uneven visual gaps because content widths vary wildly between columns.
- Custom warm colour palettes (#FBF6EF cream, #E8DFCF warm borders) create tonal layering problems when the rest of the app uses a standard grey palette. Stick to the design system tokens.
- When a header row tint is close to the page background, it creates ambiguity rather than hierarchy. Better to use typography and border weight to distinguish headers from data rows.
- Inline `style={{}}` for spacing fights Tailwind and makes iteration painful. Use Tailwind classes for all spacing; reserve inline styles for colours that have no Tailwind token.

## What's next

- Post-appointment tab implementation (follow-up spec).
- Standalone collection editor.
- Wire "in flight" links to filtered readiness dashboard view.
