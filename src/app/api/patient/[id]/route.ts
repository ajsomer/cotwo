import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';

/**
 * GET /api/patient/:id?session_id=xxx
 * Fetches full patient details for the contact card:
 * patient info, phone numbers, payment methods, current session context, visit history.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: patientId } = await params;
  const sessionId = request.nextUrl.searchParams.get('session_id');

  const supabase = createServiceClient();

  // Fetch patient, phone numbers, and payment methods in parallel
  const [patientRes, phonesRes, cardsRes] = await Promise.all([
    supabase
      .from('patients')
      .select('id, first_name, last_name, date_of_birth')
      .eq('id', patientId)
      .single(),
    supabase
      .from('patient_phone_numbers')
      .select('phone_number, is_primary')
      .eq('patient_id', patientId)
      .order('is_primary', { ascending: false }),
    supabase
      .from('payment_methods')
      .select('card_brand, card_last_four, card_expiry, is_default')
      .eq('patient_id', patientId)
      .order('is_default', { ascending: false }),
  ]);

  if (patientRes.error || !patientRes.data) {
    return NextResponse.json({ error: 'Patient not found' }, { status: 404 });
  }

  // Fetch current session context if session_id provided
  let currentSession = null;
  if (sessionId) {
    const { data } = await supabase
      .from('sessions')
      .select(`
        status,
        appointments (
          scheduled_at,
          appointment_types ( name ),
          rooms:rooms!appointments_room_id_fkey ( name )
        )
      `)
      .eq('id', sessionId)
      .single();

    if (data) {
      const appt = data.appointments as Record<string, unknown> | null;
      currentSession = {
        status: data.status,
        scheduled_at: appt?.scheduled_at ?? null,
        type_name: (appt?.appointment_types as Record<string, unknown> | null)?.name ?? null,
        room_name: (appt?.rooms as Record<string, unknown> | null)?.name ?? null,
      };
    }
  }

  // Fetch form assignments for this patient
  const { data: formAssignmentsData } = await supabase
    .from('form_assignments')
    .select('id, form_id, status, sent_at, completed_at, created_at, submission_id')
    .eq('patient_id', patientId)
    .order('created_at', { ascending: false });

  // Get form names for assignments
  const formIds = [...new Set((formAssignmentsData ?? []).map((a) => a.form_id))];
  let formNameMap: Record<string, string> = {};
  if (formIds.length > 0) {
    const { data: formsData } = await supabase
      .from('forms')
      .select('id, name')
      .in('id', formIds);
    if (formsData) {
      formNameMap = Object.fromEntries(formsData.map((f) => [f.id, f.name]));
    }
  }

  const formAssignments = (formAssignmentsData ?? []).map((a) => ({
    id: a.id,
    form_name: formNameMap[a.form_id] ?? 'Unknown form',
    status: a.status,
    sent_at: a.sent_at,
    completed_at: a.completed_at,
    created_at: a.created_at,
    submission_id: a.submission_id,
  }));

  // Fetch visit history: past done sessions for this patient
  const { data: historyData } = await supabase
    .from('session_participants')
    .select(`
      sessions (
        status,
        session_created_at:created_at,
        appointments (
          scheduled_at,
          appointment_types ( name )
        )
      )
    `)
    .eq('patient_id', patientId)
    .order('created_at', { ascending: false })
    .limit(10);

  const visitHistory = (historyData ?? [])
    .map((row) => {
      const session = row.sessions as Record<string, unknown> | null;
      if (!session || session.status !== 'done') return null;
      const appt = session.appointments as Record<string, unknown> | null;
      return {
        date: (appt?.scheduled_at as string) ?? (session.session_created_at as string),
        type_name: (appt?.appointment_types as Record<string, unknown> | null)?.name ?? null,
      };
    })
    .filter(Boolean);

  return NextResponse.json({
    patient: patientRes.data,
    phone_numbers: phonesRes.data ?? [],
    payment_methods: cardsRes.data ?? [],
    current_session: currentSession,
    visit_history: visitHistory,
    form_assignments: formAssignments,
  });
}
