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

/** Format today's date. e.g. "Monday 30 March 2026" */
export function formatRunsheetDate(date: Date): string {
  return date.toLocaleDateString('en-AU', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}
