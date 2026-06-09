/**
 * Nookal payload ↔ canonical translation. The ONLY place that knows both
 * shapes; the adapter and sync engine stay on the canonical side.
 *
 * External ids are kept as STRINGS (Nookal already returns them as strings;
 * never Number() them — the Cliniko build was bitten by big-int truncation).
 */
import type {
  PmsAppointment,
  PmsAppointmentType,
  PmsBusiness,
  PmsPatient,
  PmsPractitioner,
} from "../types";
import type {
  NookalAppointment,
  NookalLocation,
  NookalPatient,
  NookalPractitioner,
  NookalService,
} from "./types";

export function mapPatient(n: NookalPatient): PmsPatient {
  // Mobile is a single field; the generic pull normalises it to E.164 and marks
  // the first entry primary, so we just surface it (primary-first by nature).
  const phones = [n.Mobile].filter((p): p is string => Boolean(p && p.trim()));
  return {
    externalId: String(n.ID),
    firstName: n.FirstName ?? "",
    lastName: n.LastName ?? "",
    dateOfBirth: normaliseDate(n.DOB),
    phoneNumbers: phones,
    email: n.Email ?? null,
    // Nookal patients expose no archived flag → never archived from our side.
    archived: false,
  };
}

export function mapPractitioner(n: NookalPractitioner): PmsPractitioner {
  const first = n.FirstName ?? "";
  const last = n.LastName ?? "";
  const displayName = [n.Title, first, last].filter(Boolean).join(" ").trim();
  return {
    externalId: String(n.ID),
    firstName: first,
    lastName: last,
    displayName: displayName || `Practitioner ${n.ID}`,
    email: n.Email ?? null,
    // Nookal's practitioner list has no active flag in the verified shape;
    // treat listed practitioners as active.
    active: true,
  };
}

export function mapService(n: NookalService): PmsAppointmentType {
  const duration = n.Duration ?? n.duration;
  return {
    externalId: String(n.ID),
    name: n.Name ?? n.name ?? `Service ${n.ID}`,
    durationMinutes: duration != null ? Number(duration) || null : null,
    archived: false,
  };
}

export function mapBusiness(n: NookalLocation): PmsBusiness {
  return {
    externalId: String(n.ID),
    name: n.Name || `Location ${n.ID}`,
    timeZone: n.Timezone ?? null,
    archived: Boolean(false),
  };
}

export function mapAppointment(n: NookalAppointment): PmsAppointment {
  return {
    externalId: String(n.ID),
    patientExternalId: nullableId(n.patientID),
    practitionerExternalId: nullableId(n.practitionerID),
    appointmentTypeExternalId: nullableId(n.appointmentTypeID),
    businessExternalId: nullableId(n.locationID),
    // Nookal splits date + time. We compose a single timestamp. ⚠️ Nookal times
    // are LOCAL to the location's timezone, not UTC — without a tz-aware combine
    // this is naive local time. The run sheet displays in the location tz, and
    // for the prototype this is acceptable; flagged for live verification.
    startsAt: combineDateTime(n.appointmentDate, n.appointmentStartTime),
    endsAt: combineDateTime(n.appointmentDate, n.appointmentEndTime),
    cancelled: isTrue(n.cancelled),
    didNotArrive: isTrue(n.DNA),
    archived: false,
    updatedAt: normaliseTimestamp(n.lastModified),
  };
}

// ── helpers ──

/** Nookal id strings: empty / "0" / null → null (no related resource). */
function nullableId(v: string | null | undefined): string | null {
  if (v == null) return null;
  const t = String(v).trim();
  if (t === "" || t === "0") return null;
  return t;
}

/** Nookal booleans are "1"/"0" strings. */
function isTrue(v: string | null | undefined): boolean {
  return v === "1" || (v as unknown) === 1 || v === "true";
}

/** Pass through an ISO date (YYYY-MM-DD); null if absent/blank. */
function normaliseDate(v: string | null | undefined): string | null {
  if (!v) return null;
  const t = v.trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : null;
}

/**
 * Nookal timestamps are "YYYY-MM-DD HH:MM:SS" (space-separated). Convert to an
 * ISO 8601 string for the canonical layer / cursor comparison.
 */
function normaliseTimestamp(v: string | null | undefined): string | null {
  if (!v) return null;
  const t = v.trim();
  if (!t) return null;
  // Replace the space with 'T'; leave tz unspecified (treated as the value's tz).
  return t.includes(" ") ? t.replace(" ", "T") : t;
}

/** Compose appointmentDate (YYYY-MM-DD) + time (HH:MM[:SS]) → ISO-ish string. */
function combineDateTime(
  date: string | null | undefined,
  time: string | null | undefined
): string | null {
  const d = normaliseDate(date);
  if (!d) return null;
  const t = time?.trim();
  if (!t) return `${d}T00:00:00`;
  // Normalise HH:MM → HH:MM:00 for a consistent ISO-ish shape.
  const padded = /^\d{2}:\d{2}$/.test(t) ? `${t}:00` : t;
  return `${d}T${padded}`;
}

/** Format a JS Date as Nookal's `last_modified` filter value (YYYY-MM-DD HH:MM:SS). */
export function nookalTimestamp(d: Date): string {
  // Nookal's last_modified expects "YYYY-MM-DD HH:MM:SS". Use UTC for stability.
  const iso = d.toISOString(); // 2026-06-09T12:34:56.789Z
  return iso.slice(0, 19).replace("T", " ");
}
