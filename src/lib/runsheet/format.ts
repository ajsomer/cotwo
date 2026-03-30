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

/** Format cents as currency. e.g. 15000 -> "$150.00" */
export function formatCurrency(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/** Format patient name. e.g. "Sarah Johnson" */
export function formatPatientName(
  firstName: string | null,
  lastName: string | null
): string {
  if (!firstName && !lastName) return 'Unknown patient';
  return [firstName, lastName].filter(Boolean).join(' ');
}

/** Format a relative time like "5 min ago" or "in 10 min". */
export function formatRelativeTime(date: Date, now: Date): string {
  const diffMs = date.getTime() - now.getTime();
  const diffMin = Math.round(diffMs / 60000);

  if (Math.abs(diffMin) < 1) return 'now';
  if (diffMin > 0) return `in ${diffMin} min`;
  return `${Math.abs(diffMin)} min ago`;
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
