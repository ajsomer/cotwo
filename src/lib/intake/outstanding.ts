import { db } from '@/lib/db';
import {
  intakePackageJourneys,
  appointments as appointmentsT,
  locations as locationsT,
} from '@/lib/db/schema';
import { and, eq, ne } from 'drizzle-orm';

export interface OutstandingJourney {
  token: string;
  appointmentId: string;
  scheduledAt: string | null;
}

export interface OutstandingCheck {
  journeys: OutstandingJourney[];
  /**
   * Reserved for future clinician-override wiring. Always false in MVP.
   */
  overrideAllowed: boolean;
}

/**
 * Returns intake-package journeys this patient still needs to complete for
 * upcoming appointments in the given org. Used by the arrival-flow gate to
 * decide whether the patient should be sent through the intake UI before
 * reaching the waiting room.
 *
 * "Outstanding" = journey.status != 'completed' AND the appointment is in
 * the future. Already-transcribed-but-pending packages do not block a
 * patient since the patient has done their part.
 */
export async function getOutstandingJourneysForPatient(
  patientId: string,
  orgId: string
): Promise<OutstandingCheck> {
  let rows: Array<{
    journey_token: string;
    status: string;
    appointment_id: string;
    scheduled_at: string | null;
    org_id: string;
  }>;
  try {
    rows = await db
      .select({
        journey_token: intakePackageJourneys.journeyToken,
        status: intakePackageJourneys.status,
        appointment_id: intakePackageJourneys.appointmentId,
        scheduled_at: appointmentsT.scheduledAt,
        org_id: locationsT.orgId,
      })
      .from(intakePackageJourneys)
      .innerJoin(
        appointmentsT,
        eq(appointmentsT.id, intakePackageJourneys.appointmentId)
      )
      .innerJoin(locationsT, eq(locationsT.id, appointmentsT.locationId))
      .where(
        and(
          eq(intakePackageJourneys.patientId, patientId),
          ne(intakePackageJourneys.status, 'completed')
        )
      );
  } catch {
    return { journeys: [], overrideAllowed: false };
  }

  const now = Date.now();
  const journeys = rows
    .filter((row) => row.org_id === orgId)
    .filter((row) => {
      const ts = row.scheduled_at;
      if (!ts) return true; // collection-only / unscheduled — still gate
      return new Date(ts).getTime() >= now;
    })
    .map((row) => ({
      token: row.journey_token,
      appointmentId: row.appointment_id,
      scheduledAt: row.scheduled_at ?? null,
    }))
    .sort((a, b) => {
      // Most imminent first; nulls (collection-only) last.
      if (!a.scheduledAt && !b.scheduledAt) return 0;
      if (!a.scheduledAt) return 1;
      if (!b.scheduledAt) return -1;
      return new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime();
    });

  return { journeys, overrideAllowed: false };
}
