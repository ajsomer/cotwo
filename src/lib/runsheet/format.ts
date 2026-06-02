/** Format a scheduled time for display on the run sheet. e.g. "9:30 AM" */
export function formatSessionTime(scheduledAt: string | null): string {
  if (!scheduledAt) return '--:--';
  const date = new Date(scheduledAt);
  return date.toLocaleTimeString('en-AU', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

export type SessionTimeSource = 'scheduled' | 'joined' | 'none';

export interface SessionTimeDisplay {
  /** Formatted time string, e.g. "9:30 AM". null when no time is known. */
  text: string | null;
  source: SessionTimeSource;
}

/**
 * Resolve which time to show in the run sheet time column and what it means.
 * - Scheduled appointment      -> the scheduled time.
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

/** Format cents as currency. e.g. 15000 -> "$150.00" */
export function formatCurrency(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/** Format patient name, falling back to phone number if no name is known yet. */
export function formatPatientName(
  firstName: string | null,
  lastName: string | null,
  phoneNumber?: string | null
): string {
  if (firstName || lastName) {
    return [firstName, lastName].filter(Boolean).join(' ');
  }
  if (phoneNumber) {
    return formatPhoneNumber(phoneNumber) ?? phoneNumber;
  }
  return 'Unknown patient';
}

/** Format a relative time like "5 min ago" or "in 10 min". */
export function formatRelativeTime(date: Date, now: Date): string {
  const diffMs = date.getTime() - now.getTime();
  const diffMin = Math.round(diffMs / 60000);

  if (Math.abs(diffMin) < 1) return 'now';
  if (diffMin > 0) return `in ${diffMin} min`;
  return `${Math.abs(diffMin)} min ago`;
}

/** Format an Australian phone number for display. e.g. "+61450336880" -> "0450 336 880" */
export function formatPhoneNumber(phone: string | null): string | null {
  if (!phone) return null;
  // Strip +61 prefix and leading zeros
  const digits = phone.replace(/\D/g, '').replace(/^61/, '');
  if (digits.length === 9) {
    // Mobile: 0XXX XXX XXX
    return `0${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6)}`;
  }
  if (digits.length === 10 && digits.startsWith('0')) {
    return `${digits.slice(0, 4)} ${digits.slice(4, 7)} ${digits.slice(7)}`;
  }
  return phone;
}

/**
 * Compute the UTC instants bounding a calendar day *in a given timezone*.
 *
 * The run sheet's "today" is the clinic's local day (Australia/Sydney), but
 * `created_at` / `scheduled_at` are stored as UTC `timestamptz`. Building the
 * window with `setHours(0,0,0,0)` uses the Node server's local time (UTC on
 * Vercel), so a Sydney on-demand session created before ~10am local — whose
 * UTC date is still "yesterday" — falls before the UTC start-of-day and gets
 * filtered out of the run sheet. We instead find the local civil date for the
 * instant, then resolve that local midnight / end-of-day back to UTC using the
 * zone's offset at each boundary.
 */
export function dayBoundsInTimeZone(
  instant: Date,
  timeZone: string
): { startOfDay: Date; endOfDay: Date } {
  // The civil Y-M-D in the target zone for this instant.
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const y = Number(get('year'));
  const m = Number(get('month'));
  const d = Number(get('day'));

  // Resolve a local wall-clock time in `timeZone` to its UTC instant. We seed
  // with the UTC interpretation, measure how far that instant's zone rendering
  // is from the wall time we wanted, and correct by that offset. Two passes
  // settle DST/edge cases where the first correction lands in a different
  // offset.
  const localWallToUtc = (
    hour: number,
    minute: number,
    second: number,
    ms: number
  ): Date => {
    let utc = new Date(Date.UTC(y, m - 1, d, hour, minute, second, ms));
    for (let i = 0; i < 2; i++) {
      const seen = new Intl.DateTimeFormat('en-US', {
        timeZone,
        hourCycle: 'h23',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      }).formatToParts(utc);
      const sv = (t: string) => Number(seen.find((p) => p.type === t)?.value ?? '0');
      const seenAsUtc = Date.UTC(
        sv('year'),
        sv('month') - 1,
        sv('day'),
        sv('hour'),
        sv('minute'),
        sv('second'),
        ms
      );
      const wantedAsUtc = Date.UTC(y, m - 1, d, hour, minute, second, ms);
      const drift = seenAsUtc - wantedAsUtc;
      if (drift === 0) break;
      utc = new Date(utc.getTime() - drift);
    }
    return utc;
  };

  return {
    startOfDay: localWallToUtc(0, 0, 0, 0),
    endOfDay: localWallToUtc(23, 59, 59, 999),
  };
}

/** Format today's date. e.g. "Monday 30 March 2026" */
export function formatRunsheetDate(date: Date): string {
  return date.toLocaleDateString('en-AU', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}
