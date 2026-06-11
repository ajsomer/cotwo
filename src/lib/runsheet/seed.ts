"use server";

import { db } from "@/lib/db";
import {
  sessionParticipants,
  payments,
  sessions as sessionsT,
  appointments as appointmentsT,
  appointmentActions,
  fileDeliveries,
  intakePackageJourneys,
  paymentMethods,
  patientPhoneNumbers,
  patients as patientsT,
  phoneVerifications,
  appointmentTypes,
  staffAssignments,
  locations as locationsT,
  organisations as organisationsT,
  rooms as roomsT,
} from "@/lib/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { getAuthenticatedUserId } from "@/lib/auth/staff-access";

/**
 * Seeds the database with demo data for the run sheet.
 * Authorization is enforced in app code (RLS was dropped in the Neon migration).
 *
 * Resolves the authenticated user's org and location dynamically.
 * Does NOT create or modify rooms, org, location, users, or staff assignments.
 * Only populates session-related data (patients, appointments, sessions, etc.)
 * for whatever rooms already exist at the user's location.
 */

/**
 * Removes all session-related data from the database.
 * Preserves rooms, org, location, users, staff assignments, and appointment types.
 */
export async function nukeSessions() {
  try {
    await deleteSessionData();
    return { success: true };
  } catch (err) {
    console.error("[NUKE] Failed:", err);
    return { success: false, error: String(err) };
  }
}

/**
 * The shared delete pass for nuke + re-seed. Order matters: several tables
 * reference sessions/patients with NO ACTION (no cascade), so they must go
 * before the rows they point at — file_deliveries and appointment_actions
 * before sessions, intake_package_journeys before patients (the appointment
 * cascade catches journeys with an appointment, this catches the rest).
 */
async function deleteSessionData() {
  await db.delete(fileDeliveries);
  await db.delete(appointmentActions);
  await db.delete(sessionParticipants);
  await db.delete(payments);
  await db.delete(sessionsT);
  await db.delete(appointmentsT); // cascades workflow runs + linked journeys
  await db.delete(intakePackageJourneys);
  await db.delete(paymentMethods);
  await db.delete(patientPhoneNumbers);
  await db.delete(patientsT);
  await db.delete(phoneVerifications);
}

export async function seedDemoData() {
  // Get the authenticated user's org and location (local cookie verification).
  const userId = await getAuthenticatedUserId();

  if (!userId) {
    return { success: false, error: "Not authenticated" };
  }

  // Resolve the user's staff assignment to find their org and location
  const [assignment] = await db
    .select({
      location_id: staffAssignments.locationId,
      org_id: locationsT.orgId,
      location_timezone: locationsT.timezone,
      org_timezone: organisationsT.timezone,
    })
    .from(staffAssignments)
    .innerJoin(locationsT, eq(locationsT.id, staffAssignments.locationId))
    .innerJoin(organisationsT, eq(organisationsT.id, locationsT.orgId))
    .where(eq(staffAssignments.userId, userId))
    .limit(1);

  if (!assignment) {
    return { success: false, error: "No staff assignment found. Complete clinic setup first." };
  }

  const LOCATION_ID = assignment.location_id;
  const ORG_ID = assignment.org_id;
  const TIMEZONE = assignment.location_timezone ?? "Australia/Sydney";

  try {
    // Clean existing session data (preserves rooms, org, location, staff)
    await deleteSessionData();

    // Appointment types are owned by org/clinic setup, NOT the demo seed — the
    // seed only creates patient/session data. Read the org's existing types to
    // attach to the seeded appointments (no type creation here).
    const orgTypes = await db
      .select({ id: appointmentTypes.id })
      .from(appointmentTypes)
      .where(eq(appointmentTypes.orgId, ORG_ID))
      .orderBy(appointmentTypes.createdAt);

    if (!orgTypes || orgTypes.length === 0) {
      return {
        success: true,
        warning:
          "No appointment types found — seed patient data not created. Set up appointment types in Settings first.",
      };
    }
    const appointmentTypeIds = orgTypes.map((t) => t.id);

    const patientData = [
      { id: "00000000-0000-0000-0000-000000004001", orgId: ORG_ID, firstName: "Emily", lastName: "Chen", dateOfBirth: "1992-03-15" },
      { id: "00000000-0000-0000-0000-000000004002", orgId: ORG_ID, firstName: "Marcus", lastName: "Williams", dateOfBirth: "1985-07-22" },
      { id: "00000000-0000-0000-0000-000000004003", orgId: ORG_ID, firstName: "Sophie", lastName: "Taylor", dateOfBirth: "1998-11-08" },
      { id: "00000000-0000-0000-0000-000000004004", orgId: ORG_ID, firstName: "David", lastName: "Park", dateOfBirth: "1976-01-30" },
      { id: "00000000-0000-0000-0000-000000004005", orgId: ORG_ID, firstName: "Olivia", lastName: "Brown", dateOfBirth: "2001-06-14" },
      { id: "00000000-0000-0000-0000-000000004006", orgId: ORG_ID, firstName: "James", lastName: "Morrison", dateOfBirth: "1990-09-25" },
      { id: "00000000-0000-0000-0000-000000004007", orgId: ORG_ID, firstName: "Anika", lastName: "Patel", dateOfBirth: "1988-04-12" },
      { id: "00000000-0000-0000-0000-000000004008", orgId: ORG_ID, firstName: "Ryan", lastName: "Hughes", dateOfBirth: "1995-12-03" },
    ];
    await db
      .insert(patientsT)
      .values(patientData)
      .onConflictDoUpdate({
        target: patientsT.id,
        set: { orgId: ORG_ID },
      });

    await db
      .insert(patientPhoneNumbers)
      .values(
        patientData.map((p, i) => ({
          id: `00000000-0000-0000-0000-00000000b0${(i + 1).toString().padStart(2, "0")}`,
          patientId: p.id,
          phoneNumber: `+6141234500${i + 1}`,
          isPrimary: true,
        }))
      )
      .onConflictDoUpdate({
        target: patientPhoneNumbers.id,
        set: { isPrimary: true },
      });

    await db
      .insert(paymentMethods)
      .values([
        { id: "00000000-0000-0000-0000-00000000c001", patientId: "00000000-0000-0000-0000-000000004001", stripePaymentMethodId: "pm_test_001", cardLastFour: "4242", cardBrand: "Visa", cardExpiry: "12/27", isDefault: true },
        { id: "00000000-0000-0000-0000-00000000c002", patientId: "00000000-0000-0000-0000-000000004002", stripePaymentMethodId: "pm_test_002", cardLastFour: "5555", cardBrand: "Mastercard", cardExpiry: "08/26", isDefault: true },
        { id: "00000000-0000-0000-0000-00000000c003", patientId: "00000000-0000-0000-0000-000000004004", stripePaymentMethodId: "pm_test_004", cardLastFour: "1234", cardBrand: "Visa", cardExpiry: "03/28", isDefault: true },
      ])
      .onConflictDoUpdate({
        target: paymentMethods.id,
        set: { isDefault: true },
      });

    // ========================================================================
    // Read existing rooms at the user's location and generate time-aware sessions
    // ========================================================================
    const rooms = await db
      .select({ id: roomsT.id, room_type: roomsT.roomType, sort_order: roomsT.sortOrder })
      .from(roomsT)
      .where(eq(roomsT.locationId, LOCATION_ID))
      .orderBy(roomsT.sortOrder);

    if (!rooms || rooms.length === 0) {
      return { success: true, warning: "No rooms found — sessions not seeded. Create rooms in Settings first." };
    }

    // Find clinicians assigned to this location for realistic session data
    const clinicians = await db
      .select({ user_id: staffAssignments.userId })
      .from(staffAssignments)
      .where(
        and(
          eq(staffAssignments.locationId, LOCATION_ID),
          inArray(staffAssignments.role, ["clinician", "clinic_owner"])
        )
      );

    const filteredClinicianIds = clinicians.map((c) => c.user_id);
    if (filteredClinicianIds.length === 0) {
      filteredClinicianIds.push(userId); // fallback to the current user
    }

    // Determine current time in the clinic's timezone
    const now = new Date();
    const localTimeStr = now.toLocaleString("en-AU", { timeZone: TIMEZONE, hour12: false });
    const timeParts = localTimeStr.split(", ")[1]?.split(":") ?? [];
    const localHour = parseInt(timeParts[0] ?? "12", 10);
    const localMinute = parseInt(timeParts[1] ?? "0", 10);

    // Clinic day: 8am to 5pm. Slot duration = 30 min.
    const CLINIC_START = 8; // 8:00 AM
    const CLINIC_END = 17;  // 5:00 PM
    const SLOT_MINUTES = 30;
    const totalSlots = (CLINIC_END - CLINIC_START) * 60 / SLOT_MINUTES; // 18 slots

    // How many minutes into the clinic day are we?
    const minutesIntoClinincDay = Math.max(0, (localHour - CLINIC_START) * 60 + localMinute);
    const currentSlotIdx = Math.min(Math.floor(minutesIntoClinincDay / SLOT_MINUTES), totalSlots - 1);

    // Before clinic hours: show a full day of upcoming. After: show a full day of done.
    const beforeClinic = localHour < CLINIC_START;
    const afterClinic = localHour >= CLINIC_END;

    // Helper: get the absolute time for a given slot index
    function slotTime(slotIdx: number): Date {
      const d = new Date(now);
      // Set to today's date in local tz by offsetting
      const offsetMs = minutesIntoClinincDay * 60_000;
      const clinicStartMs = d.getTime() - offsetMs; // time at clinic open
      return new Date(clinicStartMs + slotIdx * SLOT_MINUTES * 60_000);
    }

    // Assign each room ~4-6 slots spread across the day
    // Each room gets: past slots (done), one outstanding action, current/near slot, future slots (upcoming)
    let sessionCounter = 0;
    const pad = (n: number) => n.toString().padStart(3, "0");

    for (let roomIdx = 0; roomIdx < rooms.length; roomIdx++) {
      const room = rooms[roomIdx];
      const clinicianId = filteredClinicianIds[roomIdx % filteredClinicianIds.length];

      // Spread slots for this room: every N slots, offset by room index
      const roomSlots: number[] = [];
      const spacing = Math.max(2, Math.floor(totalSlots / 5)); // ~5 appointments per room
      for (let s = roomIdx % spacing; s < totalSlots; s += spacing) {
        roomSlots.push(s);
      }

      // Track whether this room has used its one outstanding action
      let hasOutstandingAction = false;

      for (const slotIdx of roomSlots) {
        sessionCounter++;
        const patientId = patientData[(sessionCounter - 1) % patientData.length].id;
        const typeId = appointmentTypeIds[sessionCounter % appointmentTypeIds.length];
        const phone = `+6141234500${((sessionCounter - 1) % patientData.length) + 1}`;
        const scheduledAt = slotTime(slotIdx);
        const suffix = pad(sessionCounter);
        const apptId = `00000000-0000-0000-0000-000000005${suffix}`;
        const sessionId = `00000000-0000-0000-0000-000000006${suffix}`;
        const participantId = `00000000-0000-0000-0000-00000000e${suffix}`;

        let status: "queued" | "done" | "complete" | "in_session";
        let notificationSent = true;
        let patientArrived = false;
        let patientArrivedAt: string | null = null;
        let sessionStartedAt: string | null = null;
        let sessionEndedAt: string | null = null;

        if (beforeClinic) {
          // Before 8am: everything is upcoming/queued
          status = "queued";
          notificationSent = slotIdx < 4; // first few have been notified
          patientArrived = false;
        } else if (afterClinic) {
          // After 5pm: everything is done
          status = "done";
          patientArrived = true;
          patientArrivedAt = new Date(scheduledAt.getTime() - 5 * 60_000).toISOString();
          sessionStartedAt = scheduledAt.toISOString();
          sessionEndedAt = new Date(scheduledAt.getTime() + 25 * 60_000).toISOString();
        } else if (slotIdx < currentSlotIdx - 1) {
          // Well in the past: done
          status = "done";
          patientArrived = true;
          patientArrivedAt = new Date(scheduledAt.getTime() - 5 * 60_000).toISOString();
          sessionStartedAt = scheduledAt.toISOString();
          sessionEndedAt = new Date(scheduledAt.getTime() + 25 * 60_000).toISOString();
        } else if (slotIdx === currentSlotIdx - 1 && !hasOutstandingAction) {
          // Just finished — needs processing (one per room)
          status = "complete";
          hasOutstandingAction = true;
          patientArrived = true;
          patientArrivedAt = new Date(scheduledAt.getTime() - 5 * 60_000).toISOString();
          sessionStartedAt = scheduledAt.toISOString();
          sessionEndedAt = new Date(scheduledAt.getTime() + 25 * 60_000).toISOString();
        } else if (slotIdx === currentSlotIdx) {
          // Current slot: in session
          status = "in_session";
          patientArrived = true;
          patientArrivedAt = new Date(scheduledAt.getTime() - 3 * 60_000).toISOString();
          sessionStartedAt = scheduledAt.toISOString();
        } else if (slotIdx === currentSlotIdx + 1) {
          // Next slot: upcoming, notified
          status = "queued";
          notificationSent = true;
          patientArrived = false;
        } else {
          // Further future: queued, not yet notified
          status = "queued";
          notificationSent = false;
          patientArrived = false;
        }

        // Insert appointment
        await db
          .insert(appointmentsT)
          .values({
            id: apptId,
            orgId: ORG_ID,
            patientId: patientId,
            clinicianId: clinicianId,
            appointmentTypeId: typeId,
            roomId: room.id,
            locationId: LOCATION_ID,
            scheduledAt: scheduledAt.toISOString(),
            phoneNumber: phone,
          })
          .onConflictDoUpdate({
            target: appointmentsT.id,
            set: {
              scheduledAt: scheduledAt.toISOString(),
              roomId: room.id,
              clinicianId: clinicianId,
            },
          });

        // Insert session
        await db
          .insert(sessionsT)
          .values({
            id: sessionId,
            appointmentId: apptId,
            roomId: room.id,
            locationId: LOCATION_ID,
            status,
            notificationSent: notificationSent,
            notificationSentAt: notificationSent ? new Date(scheduledAt.getTime() - 120 * 60_000).toISOString() : null,
            patientArrived: patientArrived,
            patientArrivedAt: patientArrivedAt,
            sessionStartedAt: sessionStartedAt,
            sessionEndedAt: sessionEndedAt,
            createdAt: now.toISOString(),
          })
          .onConflictDoUpdate({
            target: sessionsT.id,
            set: {
              status,
              notificationSent: notificationSent,
              patientArrived: patientArrived,
            },
          });

        // Insert participant
        await db
          .insert(sessionParticipants)
          .values({
            id: participantId,
            sessionId: sessionId,
            patientId: patientId,
          })
          .onConflictDoUpdate({
            target: sessionParticipants.id,
            set: { patientId: patientId },
          });
      }
    }

    return { success: true };
  } catch (err) {
    console.error("[SEED] Failed:", err);
    return { success: false, error: String(err) };
  }
}
