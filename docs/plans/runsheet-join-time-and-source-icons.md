# Run sheet: show join time + scheduled/on-demand source icons

## Goal

Two related improvements to the run sheet time column:

1. **On-demand sessions show a real time instead of `--:--`.** Today, sessions
   with no appointment (patient joined via the room link) have
   `scheduled_at === null`, so `formatSessionTime` renders `--:--`. Replace that
   with the time the patient joined the waiting room.
2. **A small icon next to each time signals its meaning** — whether the time is
   a *scheduled* appointment time or an *on-demand join* time.

## Background — what the data actually says

On-demand (room-link) sessions are created in `src/app/api/patient/arrive/route.ts`.
They are inserted with **no `appointment_id`** and therefore no `scheduled_at`,
and `patient_arrived_at` is stamped at creation. That creation happens at the
**final step of the patient entry flow** (Arrive — after OTP, identity, card, and
outstanding items), so for on-demand sessions `patient_arrived_at` is the moment
the patient finished their details and landed in the waiting room — exactly the
"time joined" we want to surface.

Distinguishing signal (already on every row, no schema/query change):

- **Scheduled session** → `scheduled_at !== null` (came from an appointment).
- **On-demand session** → `scheduled_at === null` (joined via room `link_token`,
  `appointment_id` is null).

`RunsheetSession` already carries `scheduled_at`, `patient_arrived_at`, and
`session_created_at` (`src/lib/supabase/custom-types.ts`), and they're already
selected in `src/lib/runsheet/queries.ts`. **No DB or query changes required.**

## Decisions (from review)

- **Time shown for on-demand:** `patient_arrived_at` (the waiting-room join time),
  falling back to `session_created_at` if arrival isn't set. For on-demand these
  are effectively the same instant.
- **Visual distinction:** icon only (no text label) — the time column is just 94px.
- **Icon placement:** inside the time column, beside the time value.

## Implementation

### 1. Time formatting — `src/lib/runsheet/format.ts`

`formatSessionTime` currently takes only `scheduledAt`. Add a small helper that
picks the right time and labels its source, leaving `formatSessionTime` intact
for any other callers.

```ts
export type SessionTimeSource = 'scheduled' | 'joined' | 'none';

export interface SessionTimeDisplay {
  /** Formatted time string, e.g. "9:30 AM". null when no time is known. */
  text: string | null;
  source: SessionTimeSource;
}

/**
 * Resolve which time to show in the run sheet time column and what it means.
 * - Scheduled appointment  -> the scheduled time.
 * - On-demand (no appointment) -> the time the patient joined the waiting room
 *   (patient_arrived_at, falling back to session_created_at).
 */
export function resolveSessionTime(session: {
  scheduled_at: string | null;
  patient_arrived_at: string | null;
  session_created_at: string;
}): SessionTimeDisplay {
  if (session.scheduled_at) {
    return { text: formatSessionTime(session.scheduled_at), source: 'scheduled' };
  }
  const joined = session.patient_arrived_at ?? session.session_created_at;
  if (joined) {
    return { text: formatSessionTime(joined), source: 'joined' };
  }
  return { text: null, source: 'none' };
}
```

Note: `formatSessionTime` keeps returning `--:--` for null; `resolveSessionTime`
should only fall through to `source: 'none'` in the (practically impossible) case
where even `session_created_at` is missing, so the column never shows `--:--` for
a real on-demand session.

### 2. Time column rendering — `src/components/clinic/runsheet/session-row.tsx`

Replace:

```ts
const time = formatSessionTime(session.scheduled_at);
```

with:

```ts
const { text: time, source: timeSource } = resolveSessionTime(session);
```

Update the time column (currently lines ~47–50) to render the icon + time. Use
`lucide-react` (already a dependency — see `WifiOff` import in this file):

- **Scheduled** → `CalendarClock` icon, tooltip "Scheduled appointment".
- **Joined / on-demand** → `LogIn` icon, tooltip "Joined at <time> (no scheduled time)".

```tsx
{/* Time column — icon signals scheduled vs on-demand join */}
<span className="flex flex-col items-center justify-center w-[100px] flex-shrink-0 ...">
  <span className="flex items-center gap-1">
    {timeSource === 'scheduled' && (
      <Tooltip content="Scheduled appointment">
        <CalendarClock size={12} className="text-gray-400" />
      </Tooltip>
    )}
    {timeSource === 'joined' && (
      <Tooltip content="On-demand — joined the waiting room at this time">
        <LogIn size={12} className="text-teal-500" />
      </Tooltip>
    )}
    <span className="text-[13px] font-medium whitespace-nowrap">{time ?? '--:--'}</span>
  </span>
</span>
```

Icon colour follows the existing palette: gray-400 for the neutral/scheduled
case, teal-500 for on-demand (teal = "live / happening now", consistent with the
active-session treatment already used in this row). Keep icons at 12px.

**Column width:** the icon is genuinely new content in a previously time-only
column. A 12px icon + 4px gap + a wide time like "10:30 AM" sits close to the old
94px limit and could clip on devices that render Inter wide. Bump the time column
from `w-[94px]` to `w-[100px]` to accommodate the icon. `whitespace-nowrap` already
prevents wrapping; the width bump just buys breathing room. Verified the `94px`
width is local to `session-row.tsx` — no sibling spacer in `room-container.tsx` or
elsewhere needs matching, so this is a single-value change.

### 3. Sort stability — `src/lib/runsheet/grouping.ts`

`sortSessions` (within a room, same priority) sorts by `scheduled_at`, treating
null as `0`, which currently floats on-demand sessions to the very top of their
priority band. Now that on-demand rows have a meaningful join time, sort them by
that instead so they interleave sensibly:

```ts
// Sort key: scheduled time for appointments, join time for on-demand.
// Guard against NaN — a NaN return from the comparator silently corrupts the
// sort rather than throwing. session_created_at is NOT NULL so this can't fire
// in practice, but the guard keeps a malformed timestamp from scrambling order.
function sortTime(s: EnrichedSession): number {
  const raw = s.scheduled_at ?? s.patient_arrived_at ?? s.session_created_at;
  const t = raw ? new Date(raw).getTime() : 0;
  return Number.isNaN(t) ? 0 : t;
}

const aTime = sortTime(a);
const bTime = sortTime(b);
return aTime - bTime;
```

This is a behaviour change but a correct one: on-demand walk-ins now order by when
they actually arrived rather than always jumping to the front. Worth a quick visual
check after implementing. (In practice priority ordering dominates — on-demand
sessions are usually `waiting`/`in_session`, a higher band than scheduled `queued`
rows — so movement is mostly within the on-demand group itself.)

## Out of scope / explicitly not changing

- No schema migration, no change to `queries.ts` (all fields already fetched).
- No change to derived-state logic (`isLate`/`isUpcoming`/`isRunningOver` all
  correctly no-op on null `scheduled_at`, which is right for on-demand).
- The "Add session" panel and Plan-Tomorrow flow only create scheduled sessions,
  so they're unaffected.

## Files touched

| File | Change |
|------|--------|
| `src/lib/runsheet/format.ts` | Add `SessionTimeSource`, `SessionTimeDisplay`, `resolveSessionTime`. |
| `src/components/clinic/runsheet/session-row.tsx` | Use `resolveSessionTime`; render `CalendarClock` / `LogIn` icon + time in the time column. |
| `src/lib/runsheet/grouping.ts` | Fall back to join time when sorting on-demand sessions. |

## Verification

1. Run the app and view a location's run sheet.
2. **Scheduled session**: time column shows the appointment time with the
   calendar icon; tooltip reads "Scheduled appointment".
3. **On-demand session** (join via a room `link_token`, complete the entry flow):
   the row's time column shows the join time (not `--:--`) with the on-demand
   icon; tooltip explains it's a join time.
4. Confirm on-demand rows sort by join time within their priority band, and the
   94px column still renders cleanly on one line (icon + time, no wrap).
