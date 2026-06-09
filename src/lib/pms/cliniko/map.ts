/**
 * Cliniko payload ↔ canonical translation. The ONLY place that knows both
 * shapes; the adapter and sync engine stay on the canonical side.
 */
import type {
  PmsAppointment,
  PmsAppointmentType,
  PmsBusiness,
  PmsPatient,
  PmsPractitioner,
} from "../types";
import { idFromSelfLink } from "./client";
import type {
  ClinikoAppointmentType,
  ClinikoBusiness,
  ClinikoIndividualAppointment,
  ClinikoPatient,
  ClinikoPractitioner,
} from "./types";

export function mapPatient(c: ClinikoPatient): PmsPatient {
  return {
    externalId: String(c.id),
    firstName: c.first_name ?? "",
    lastName: c.last_name ?? "",
    dateOfBirth: c.date_of_birth ?? null,
    phoneNumbers: (c.patient_phone_numbers ?? [])
      .map((p) => p.number)
      .filter(Boolean),
    email: c.email ?? null,
    archived: Boolean(c.archived_at),
  };
}

export function mapPractitioner(c: ClinikoPractitioner): PmsPractitioner {
  const first = c.first_name ?? "";
  const last = c.last_name ?? "";
  const displayName = [c.title, first, last].filter(Boolean).join(" ").trim();
  return {
    externalId: String(c.id),
    firstName: first,
    lastName: last,
    displayName: displayName || `Practitioner ${c.id}`,
    email: null,
    active: c.active,
  };
}

export function mapAppointmentType(c: ClinikoAppointmentType): PmsAppointmentType {
  return {
    externalId: String(c.id),
    name: c.name,
    durationMinutes: c.duration_in_minutes ?? null,
    archived: Boolean(c.archived_at),
  };
}

export function mapBusiness(c: ClinikoBusiness): PmsBusiness {
  return {
    externalId: String(c.id),
    name: c.business_name || c.label || `Business ${c.id}`,
    timeZone: c.time_zone ?? null,
    archived: Boolean(c.archived_at),
  };
}

export function mapAppointment(
  c: ClinikoIndividualAppointment
): PmsAppointment {
  return {
    externalId: String(c.id),
    patientExternalId: idFromSelfLink(c.patient),
    practitionerExternalId: idFromSelfLink(c.practitioner),
    appointmentTypeExternalId: idFromSelfLink(c.appointment_type),
    businessExternalId: idFromSelfLink(c.business),
    startsAt: c.starts_at ?? null,
    endsAt: c.ends_at ?? null,
    cancelled: Boolean(c.cancelled_at),
    didNotArrive: Boolean(c.did_not_arrive),
    archived: Boolean(c.archived_at),
    updatedAt: c.updated_at ?? null,
  };
}

/** Format a JS Date as Cliniko's `q[]` UTC timestamp filter value. */
export function clinikoTimestamp(d: Date): string {
  // Cliniko accepts ISO 8601 UTC.
  return d.toISOString();
}
