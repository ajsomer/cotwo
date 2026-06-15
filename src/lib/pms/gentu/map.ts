/**
 * Raw Gentu ↔ canonical translation. Nothing provider-specific escapes this
 * file. Plan docs/plans/gentu-integration.md §3 (map.ts) + API reference §4.
 *
 * The traps this absorbs:
 * - Names: `name.given` holds given-incl-middle, but first/middle ALSO appear
 *   as `extension` entries. We prefer the extension `firstname` when present
 *   (more precise), falling back to splitting `name.given`.
 * - Contacts: an array of {system,use,rank,value}; we pick the best phone/email
 *   ordered by rank (1 = highest priority). Phones returned primary-first so the
 *   generic pull marks the first one is_primary.
 * - Ids: UUID strings — passed through, NEVER Number()'d.
 * - Appointments have NO updatedAt → updatedAt is always null (windowed
 *   re-sweep, not incremental; plan §5).
 */
import type {
  PmsAppointment,
  PmsAppointmentType,
  PmsBusiness,
  PmsPatient,
  PmsPractitioner,
} from "../types";
import type {
  GentuAppointment,
  GentuAppointmentType,
  GentuContact,
  GentuName,
  GentuPatient,
  GentuSite,
  GentuUser,
} from "./types";

/** Split a FHIR-style `given` ("Joey Doe Boe") into first + middle. */
function splitGiven(given: string | null): { first: string; middle: string } {
  const parts = (given ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first: "", middle: "" };
  return { first: parts[0], middle: parts.slice(1).join(" ") };
}

/** First name: prefer the `firstname` extension, else the head of name.given. */
function firstNameOf(p: GentuPatient): string {
  const ext = p.extension?.find((e) => e.system === "firstname")?.valueString;
  if (ext && ext.trim()) return ext.trim();
  return splitGiven(p.name?.given ?? null).first;
}

/** Contacts of a given system, highest priority (lowest rank) first. */
function contactsBySystem(
  contacts: GentuContact[] | undefined,
  system: GentuContact["system"]
): string[] {
  return (contacts ?? [])
    .filter((c) => c.system === system && c.value && c.value.trim())
    .slice()
    .sort((a, b) => (a.rank ?? Number.MAX_SAFE_INTEGER) - (b.rank ?? Number.MAX_SAFE_INTEGER))
    .map((c) => c.value!.trim());
}

/**
 * Phone numbers ordered MOBILE-FIRST, then by rank. The generic pull marks the
 * first phone `is_primary`, and patient OTP / intake verify matches on the
 * mobile — so a home/work phone must not win primary over a mobile (API
 * reference §4; DoD). Within mobiles (and within non-mobiles) rank decides.
 */
function phonesMobileFirst(contacts: GentuContact[] | undefined): string[] {
  return (contacts ?? [])
    .filter((c) => c.system === "phone" && c.value && c.value.trim())
    .slice()
    .sort((a, b) => {
      const aMobile = a.use === "mobile" ? 0 : 1;
      const bMobile = b.use === "mobile" ? 0 : 1;
      if (aMobile !== bMobile) return aMobile - bMobile;
      return (a.rank ?? Number.MAX_SAFE_INTEGER) - (b.rank ?? Number.MAX_SAFE_INTEGER);
    })
    .map((c) => c.value!.trim());
}

export function mapPatient(p: GentuPatient): PmsPatient {
  // Phones mobile-first then rank-ordered; the generic pull normalises to E.164
  // and marks the first is_primary (which must be the mobile for OTP/verify).
  const phones = phonesMobileFirst(p.contact);
  const emails = contactsBySystem(p.contact, "email");
  return {
    externalId: String(p.id),
    firstName: firstNameOf(p),
    lastName: p.name?.family ?? "",
    dateOfBirth: p.birthDate ?? null,
    phoneNumbers: phones,
    email: emails[0] ?? null,
    // Healthcare patients have no archived flag; deceased is the closest signal,
    // but we keep archived=false unless a real flag surfaces (don't hide live
    // patients). Deceased handling is a deliberate gap.
    archived: false,
  };
}

function displayNameOf(name: GentuName | undefined): string {
  if (!name) return "";
  const { first } = splitGiven(name.given ?? null);
  return [name.prefix, first, name.family].filter(Boolean).join(" ").trim();
}

export function mapPractitioner(u: GentuUser): PmsPractitioner {
  const { first } = splitGiven(u.name?.given ?? null);
  const emails = contactsBySystem(u.contact, "email");
  return {
    externalId: String(u.id),
    firstName: first,
    lastName: u.name?.family ?? "",
    displayName: displayNameOf(u.name),
    email: emails[0] ?? null,
    active: u.active ?? true,
  };
}

export function mapAppointmentType(t: GentuAppointmentType): PmsAppointmentType {
  return {
    externalId: String(t.id),
    name: t.text,
    durationMinutes: t.duration ?? null,
    archived: false,
  };
}

/** A site of service maps to our PmsBusiness (the location concept — §2 item 4). */
export function mapSite(s: GentuSite): PmsBusiness {
  return {
    externalId: String(s.id),
    name: s.name ?? "",
    timeZone: null,
    archived: false,
  };
}

/** Statuses that mean the appointment won't happen as booked. */
const CANCELLED_STATUSES = new Set(["cancelled"]);
const DNA_STATUSES = new Set(["did_not_arrive"]);

export function mapAppointment(a: GentuAppointment): PmsAppointment {
  const participants = a.participant ?? [];
  const ref = (type: string) =>
    participants.find((p) => p.referenceType === type)?.referenceId ?? null;
  const status = (a.status ?? "").toLowerCase();

  return {
    externalId: String(a.id),
    patientExternalId: ref("patient") ? String(ref("patient")) : null,
    practitionerExternalId: ref("provider") ? String(ref("provider")) : null,
    appointmentTypeExternalId: a.appointmentType?.reference
      ? String(a.appointmentType.reference)
      : null,
    businessExternalId: ref("location") ? String(ref("location")) : null,
    startsAt: a.startAt ?? null,
    endsAt: a.endAt ?? null,
    cancelled: CANCELLED_STATUSES.has(status),
    didNotArrive: DNA_STATUSES.has(status),
    archived: false,
    // No updatedAt on the Gentu appointment schema → cursor is windowed, not
    // timestamp-derived (plan §5). Always null; the generic pull never advances
    // a watermark from it.
    updatedAt: null,
  };
}
