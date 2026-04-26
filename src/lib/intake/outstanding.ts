import { createServiceClient } from '@/lib/supabase/service';

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
  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from('intake_package_journeys')
    .select(
      `
      journey_token, status, appointment_id,
      appointments!inner (id, scheduled_at, location_id,
        locations!inner (org_id)
      )
    `
    )
    .eq('patient_id', patientId)
    .neq('status', 'completed');

  if (error || !data) {
    return { journeys: [], overrideAllowed: false };
  }

  type Row = {
    journey_token: string;
    status: string;
    appointment_id: string;
    appointments: {
      id: string;
      scheduled_at: string | null;
      location_id: string;
      locations: { org_id: string };
    };
  };

  const now = Date.now();
  const journeys = (data as unknown as Row[])
    .filter((row) => row.appointments?.locations?.org_id === orgId)
    .filter((row) => {
      const ts = row.appointments?.scheduled_at;
      if (!ts) return true; // collection-only / unscheduled — still gate
      return new Date(ts).getTime() >= now;
    })
    .map((row) => ({
      token: row.journey_token,
      appointmentId: row.appointment_id,
      scheduledAt: row.appointments?.scheduled_at ?? null,
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
