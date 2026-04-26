import { createServiceClient } from '@/lib/supabase/service';
import type { IntakeJourneyContext } from '@/components/patient/intake-journey';

export async function resolveJourney(
  token: string
): Promise<IntakeJourneyContext | null> {
  const supabase = createServiceClient();

  const { data: journey } = await supabase
    .from('intake_package_journeys')
    .select(
      `
      id, journey_token, status,
      appointment_id, patient_id,
      includes_card_capture, includes_consent, form_ids,
      card_captured_at, consent_completed_at, forms_completed
    `
    )
    .eq('journey_token', token)
    .single();

  if (!journey) return null;

  const { data: appointment } = await supabase
    .from('appointments')
    .select(
      `
      id, org_id, location_id, scheduled_at, phone_number, patient_id,
      appointment_types!left (id, name),
      locations!inner (id, name, stripe_account_id,
        organisations!inner (id, name, logo_url, tier)
      )
    `
    )
    .eq('id', journey.appointment_id)
    .single();

  if (!appointment) return null;

  type AppointmentRow = typeof appointment & {
    locations: {
      id: string;
      name: string;
      stripe_account_id: string | null;
      organisations: {
        id: string;
        name: string;
        logo_url: string | null;
        tier: 'core' | 'complete';
      };
    };
    appointment_types: { id: string; name: string } | null;
  };
  const typed = appointment as unknown as AppointmentRow;
  const location = typed.locations;
  const org = location.organisations;
  const apptType = typed.appointment_types;

  let terminalType: 'run_sheet' | 'collection_only' = 'run_sheet';
  if (apptType?.id) {
    const { data: link } = await supabase
      .from('type_workflow_links')
      .select('workflow_templates!inner (terminal_type)')
      .eq('appointment_type_id', apptType.id)
      .eq('direction', 'pre_appointment')
      .maybeSingle();

    const linkRow = link as unknown as
      | { workflow_templates?: { terminal_type?: 'run_sheet' | 'collection_only' } }
      | null;
    terminalType = linkRow?.workflow_templates?.terminal_type ?? 'run_sheet';
  }

  let prefillPhone: string | null = appointment.phone_number || null;
  if (!prefillPhone && appointment.patient_id) {
    const { data: phone } = await supabase
      .from('patient_phone_numbers')
      .select('phone_number')
      .eq('patient_id', appointment.patient_id)
      .eq('is_primary', true)
      .maybeSingle();
    prefillPhone = phone?.phone_number ?? null;
  }

  const formIds = (journey.form_ids as string[]) ?? [];
  let forms: Array<{ id: string; name: string }> = [];
  if (formIds.length > 0) {
    const { data: formRows } = await supabase
      .from('forms')
      .select('id, name')
      .in('id', formIds);
    forms = (formRows ?? []).map((f) => ({ id: f.id, name: f.name }));
  }

  return {
    org: {
      id: org.id,
      name: org.name,
      logo_url: org.logo_url,
      tier: org.tier,
    },
    location: {
      id: location.id,
      name: location.name,
      stripe_account_id: location.stripe_account_id,
    },
    appointment: {
      id: appointment.id,
      scheduled_at: appointment.scheduled_at,
      appointment_type_name: apptType?.name ?? null,
      terminal_type: terminalType,
      prefill_phone: prefillPhone,
    },
    journey: {
      id: journey.id,
      journey_token: journey.journey_token,
      status: journey.status,
      patient_id: journey.patient_id,
      includes_card_capture: journey.includes_card_capture,
      includes_consent: journey.includes_consent,
      form_ids: formIds,
      forms,
      card_captured_at: journey.card_captured_at,
      consent_completed_at: journey.consent_completed_at,
      forms_completed: (journey.forms_completed as Record<string, string>) ?? {},
    },
  };
}
