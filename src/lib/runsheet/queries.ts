import { cache } from 'react';
import { createServiceClient } from '@/lib/supabase/service';
import type { RunsheetSession, Room } from '@/lib/supabase/types';

/**
 * Fetch today's sessions for a location with all required joins.
 * Returns flat rows ready for enrichment and grouping.
 */
export const fetchRunsheetSessions = cache(async (
  locationId: string,
  date?: Date
): Promise<RunsheetSession[]> => {
  const supabase = createServiceClient();
  const targetDate = date ?? new Date();

  // Start and end of the target day in UTC
  const startOfDay = new Date(targetDate);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(targetDate);
  endOfDay.setHours(23, 59, 59, 999);

  const { data, error } = await supabase
    .from('sessions')
    .select(`
      id,
      status,
      entry_token,
      video_call_id,
      notification_sent,
      notification_sent_at,
      patient_arrived,
      patient_arrived_at,
      session_started_at,
      session_ended_at,
      created_at,
      appointment_id,
      room_id,
      appointments!left (
        id,
        scheduled_at,
        status,
        phone_number,
        appointment_type_id,
        clinician_id,
        appointment_types!left (
          id,
          name,
          modality,
          duration_minutes,
          default_fee_cents
        ),
        users!appointments_clinician_id_fkey (
          id,
          full_name
        )
      ),
      session_participants!left (
        patients!inner (
          id,
          first_name,
          last_name,
          payment_methods!left (
            id,
            card_last_four,
            card_brand,
            is_default
          )
        )
      ),
      rooms!left (
        id,
        name,
        room_type,
        sort_order
      )
    `)
    .eq('location_id', locationId)
    .gte('created_at', startOfDay.toISOString())
    .lte('created_at', endOfDay.toISOString());

  if (error) {
    console.error('Failed to fetch runsheet sessions:', error);
    return [];
  }

  // Transform the nested Supabase response into flat RunsheetSession rows
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []).map((row: any): RunsheetSession => {
    const appointment = row.appointments as Record<string, unknown> | null;
    const appointmentType = appointment?.appointment_types as Record<string, unknown> | null;
    const clinician = appointment?.users as Record<string, unknown> | null;
    const participants = row.session_participants as Array<Record<string, unknown>> | null;
    const patient = participants?.[0]?.patients as Record<string, unknown> | null;
    const paymentMethods = patient?.payment_methods as Array<Record<string, unknown>> | null;
    const defaultCard = paymentMethods?.find((pm) => pm.is_default) ?? paymentMethods?.[0];
    const room = row.rooms as Record<string, unknown> | null;

    return {
      session_id: row.id as string,
      status: row.status as RunsheetSession['status'],
      entry_token: row.entry_token as string,
      video_call_id: row.video_call_id as string | null,
      notification_sent: row.notification_sent as boolean,
      notification_sent_at: row.notification_sent_at as string | null,
      patient_arrived: row.patient_arrived as boolean,
      patient_arrived_at: row.patient_arrived_at as string | null,
      session_started_at: row.session_started_at as string | null,
      session_ended_at: row.session_ended_at as string | null,
      session_created_at: row.created_at as string,

      appointment_id: appointment?.id as string | null ?? null,
      scheduled_at: appointment?.scheduled_at as string | null ?? null,
      appointment_status: appointment?.status as string | null ?? null,
      phone_number: appointment?.phone_number as string | null ?? null,

      appointment_type_id: appointmentType?.id as string | null ?? null,
      type_name: appointmentType?.name as string | null ?? null,
      // On-demand sessions (joined via room link, no appointment) are always
      // telehealth by definition — room links are telehealth only.
      modality: (appointmentType?.modality as RunsheetSession['modality'])
        ?? (appointment ? null : 'telehealth'),
      duration_minutes: appointmentType?.duration_minutes as number | null ?? null,
      default_fee_cents: appointmentType?.default_fee_cents as number | null ?? null,

      patient_id: patient?.id as string | null ?? null,
      patient_first_name: patient?.first_name as string | null ?? null,
      patient_last_name: patient?.last_name as string | null ?? null,

      room_id: room?.id as string | null ?? null,
      room_name: room?.name as string | null ?? null,
      room_type: room?.room_type as RunsheetSession['room_type'] ?? null,
      room_sort_order: room?.sort_order as number | null ?? null,

      clinician_id: clinician?.id as string | null ?? null,
      clinician_name: clinician?.full_name as string | null ?? null,

      has_card_on_file: !!defaultCard,
      card_last_four: defaultCard?.card_last_four as string | null ?? null,
      card_brand: defaultCard?.card_brand as string | null ?? null,
    };
  });
});

/** Fetch all rooms at a location, ordered by sort_order. */
export const fetchLocationRooms = cache(async (locationId: string): Promise<Room[]> => {
  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from('rooms')
    .select('id, location_id, name, room_type, link_token, sort_order, payments_enabled')
    .eq('location_id', locationId)
    .order('sort_order', { ascending: true });

  if (error) {
    console.error('Failed to fetch location rooms:', error);
    return [];
  }

  return (data ?? []) as Room[];
});

/** Fetch room IDs a clinician is assigned to at a location. */
export const fetchClinicianRoomIds = cache(async (
  userId: string,
  locationId: string
): Promise<string[]> => {
  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from('clinician_room_assignments')
    .select(`
      room_id,
      staff_assignments!inner (
        user_id,
        location_id
      )
    `)
    .eq('staff_assignments.user_id', userId)
    .eq('staff_assignments.location_id', locationId);

  if (error) {
    console.error('Failed to fetch clinician room IDs:', error);
    return [];
  }

  return (data ?? []).map((row: Record<string, unknown>) => row.room_id as string);
});

/** Fetch staff assignments for a user (to determine role and locations). */
export const fetchUserStaffAssignments = cache(async (userId: string) => {
  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from('staff_assignments')
    .select(`
      id,
      user_id,
      location_id,
      role,
      employment_type,
      stripe_account_id,
      locations!inner (
        id,
        name,
        org_id,
        timezone,
        organisations!inner (
          id,
          name,
          slug,
          tier,
          logo_url,
          stripe_routing,
          timezone
        )
      )
    `)
    .eq('user_id', userId);

  if (error) {
    console.error('Failed to fetch staff assignments:', error);
    return [];
  }

  return data ?? [];
});
