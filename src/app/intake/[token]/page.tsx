import { createServiceClient } from '@/lib/supabase/service';
import { IntakeJourney, IntakeJourneyContext } from '@/components/patient/intake-journey';
import { PersistentHeader } from '@/components/patient/persistent-header';

export default async function IntakePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const context = await resolveJourney(token);

  if (!context) {
    return (
      <div className="flex flex-col items-center py-12 text-center">
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-50">
          <span className="text-lg text-red-500">!</span>
        </div>
        <h1 className="text-xl font-semibold text-gray-800">Link not found</h1>
        <p className="mt-2 text-sm text-gray-500">
          This link has expired or is no longer valid. Please contact your clinic
          for a new link.
        </p>
      </div>
    );
  }

  if (context.journey.status === 'completed') {
    return (
      <div className="flex flex-col items-center">
        <PersistentHeader
          clinicName={context.org.name}
          logoUrl={context.org.logo_url}
        />
        <div className="flex flex-col items-center py-8 text-center">
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-teal-50">
            <svg
              className="h-6 w-6 text-teal-500"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={2}
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M4.5 12.75l6 6 9-13.5"
              />
            </svg>
          </div>
          <h1 className="text-xl font-semibold text-gray-800">All done</h1>
          <p className="mt-2 text-sm text-gray-500">
            You&apos;ve already completed this intake. We&apos;ll be in touch
            before your appointment.
          </p>
        </div>
      </div>
    );
  }

  return <IntakeJourney context={context} token={token} />;
}

async function resolveJourney(
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

  // Fetch appointment + org + location + appointment type chain for branding + context
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

  // Resolve terminal_type from the pre-appointment workflow template
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

  // Resolve pre-filled phone number: prefer the appointment's stored phone
  let prefillPhone: string | null = appointment.phone_number || null;

  // If a patient is already attached, try to grab their primary phone number
  if (!prefillPhone && appointment.patient_id) {
    const { data: phone } = await supabase
      .from('patient_phone_numbers')
      .select('phone_number')
      .eq('patient_id', appointment.patient_id)
      .eq('is_primary', true)
      .maybeSingle();
    prefillPhone = phone?.phone_number ?? null;
  }

  // Fetch form names for the checklist
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
