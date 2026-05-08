/**
 * Timezone-aware day bucketing helpers.
 *
 * The repo has no date-fns-tz / luxon. We use Intl.DateTimeFormat with a
 * timeZone option to compute calendar-day triples (year/month/day) in the
 * given IANA zone, then compare those triples — never Date#getDate or
 * Date#setHours, which silently use process.env.TZ.
 */

const FALLBACK_TIMEZONE = "Australia/Sydney";

type DayTriple = { y: number; m: number; d: number };

function dayTriple(date: Date, timeZone: string): DayTriple {
  const parts = new Intl.DateTimeFormat("en-AU", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const get = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value ?? "0");

  return { y: get("year"), m: get("month"), d: get("day") };
}

function compareDay(a: DayTriple, b: DayTriple): -1 | 0 | 1 {
  if (a.y !== b.y) return a.y < b.y ? -1 : 1;
  if (a.m !== b.m) return a.m < b.m ? -1 : 1;
  if (a.d !== b.d) return a.d < b.d ? -1 : 1;
  return 0;
}

export type DayBucket = "past" | "today" | "upcoming";

/**
 * Buckets a UTC instant into past/today/upcoming relative to "now" in a given
 * IANA timezone. Returns 'today' if the instant falls on the same calendar
 * day in the timezone; 'past' if earlier; 'upcoming' if later.
 *
 * Pass `null` timezone to fall back to the deployment's primary clinic
 * timezone (Australia/Sydney). The fallback is defensive for rare rows where
 * sessions.location_id is null — production rows should always have one.
 */
export function bucketByLocalDay(
  instantIso: string,
  timezone: string | null,
  now: Date = new Date(),
): DayBucket {
  const tz = timezone ?? FALLBACK_TIMEZONE;
  const cmp = compareDay(dayTriple(new Date(instantIso), tz), dayTriple(now, tz));
  if (cmp < 0) return "past";
  if (cmp > 0) return "upcoming";
  return "today";
}
