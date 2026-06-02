import { db } from '@/lib/db';
import {
  intakePackageJourneys,
  appointments as appointmentsT,
  appointmentTypes,
  locations as locationsT,
  organisations as organisationsT,
  typeWorkflowLinks,
  workflowTemplates,
  patientPhoneNumbers,
  forms as formsT,
  sessions as sessionsT,
} from '@/lib/db/schema';
import { and, eq, inArray } from 'drizzle-orm';
import type { IntakeJourneyContext } from '@/components/patient/intake-journey';

export async function resolveJourney(
  token: string
): Promise<IntakeJourneyContext | null> {
  const [journey] = await db
    .select({
      id: intakePackageJourneys.id,
      journey_token: intakePackageJourneys.journeyToken,
      status: intakePackageJourneys.status,
      appointment_id: intakePackageJourneys.appointmentId,
      patient_id: intakePackageJourneys.patientId,
      includes_card_capture: intakePackageJourneys.includesCardCapture,
      includes_consent: intakePackageJourneys.includesConsent,
      form_ids: intakePackageJourneys.formIds,
      card_captured_at: intakePackageJourneys.cardCapturedAt,
      consent_completed_at: intakePackageJourneys.consentCompletedAt,
      forms_completed: intakePackageJourneys.formsCompleted,
    })
    .from(intakePackageJourneys)
    .where(eq(intakePackageJourneys.journeyToken, token));

  if (!journey) return null;

  // Appointment + location + org (inner) and appointment type (left).
  const [appointment] = await db
    .select({
      id: appointmentsT.id,
      org_id: appointmentsT.orgId,
      location_id: appointmentsT.locationId,
      scheduled_at: appointmentsT.scheduledAt,
      phone_number: appointmentsT.phoneNumber,
      patient_id: appointmentsT.patientId,
      appointment_type_id: appointmentTypes.id,
      appointment_type_name: appointmentTypes.name,
      location_name: locationsT.name,
      stripe_account_id: locationsT.stripeAccountId,
      org_record_id: organisationsT.id,
      org_name: organisationsT.name,
      org_logo_url: organisationsT.logoUrl,
      org_tier: organisationsT.tier,
    })
    .from(appointmentsT)
    .innerJoin(locationsT, eq(locationsT.id, appointmentsT.locationId))
    .innerJoin(organisationsT, eq(organisationsT.id, locationsT.orgId))
    .leftJoin(
      appointmentTypes,
      eq(appointmentTypes.id, appointmentsT.appointmentTypeId)
    )
    .where(eq(appointmentsT.id, journey.appointment_id));

  if (!appointment) return null;

  const apptTypeId = appointment.appointment_type_id;
  const apptTypeName = appointment.appointment_type_name;

  let terminalType: 'run_sheet' | 'collection_only' = 'run_sheet';
  if (apptTypeId) {
    const [link] = await db
      .select({ terminal_type: workflowTemplates.terminalType })
      .from(typeWorkflowLinks)
      .innerJoin(
        workflowTemplates,
        eq(workflowTemplates.id, typeWorkflowLinks.workflowTemplateId)
      )
      .where(
        and(
          eq(typeWorkflowLinks.appointmentTypeId, apptTypeId),
          eq(typeWorkflowLinks.direction, 'pre_appointment')
        )
      );

    terminalType = link?.terminal_type ?? 'run_sheet';
  }

  let prefillPhone: string | null = appointment.phone_number || null;
  if (!prefillPhone && appointment.patient_id) {
    const [phone] = await db
      .select({ phone_number: patientPhoneNumbers.phoneNumber })
      .from(patientPhoneNumbers)
      .where(
        and(
          eq(patientPhoneNumbers.patientId, appointment.patient_id),
          eq(patientPhoneNumbers.isPrimary, true)
        )
      );
    prefillPhone = phone?.phone_number ?? null;
  }

  const formIds = (journey.form_ids as string[]) ?? [];
  let forms: Array<{ id: string; name: string }> = [];
  if (formIds.length > 0) {
    const formRows = await db
      .select({ id: formsT.id, name: formsT.name })
      .from(formsT)
      .where(inArray(formsT.id, formIds));
    forms = formRows.map((f) => ({ id: f.id, name: f.name }));
  }

  // is_onboarding_demo + entry_token come from the session linked to this
  // appointment (one-to-many; take the first as the original embed did).
  const [linkedSession] = await db
    .select({
      id: sessionsT.id,
      is_onboarding_demo: sessionsT.isOnboardingDemo,
      entry_token: sessionsT.entryToken,
    })
    .from(sessionsT)
    .where(eq(sessionsT.appointmentId, journey.appointment_id))
    .limit(1);

  const isOnboardingDemo = linkedSession?.is_onboarding_demo ?? false;
  const sessionEntryToken = linkedSession?.entry_token ?? null;
  const sessionId = linkedSession?.id ?? null;

  return {
    org: {
      id: appointment.org_record_id,
      name: appointment.org_name,
      logo_url: appointment.org_logo_url,
      tier: appointment.org_tier as 'core' | 'complete',
    },
    location: {
      id: appointment.location_id,
      name: appointment.location_name,
      stripe_account_id: appointment.stripe_account_id,
    },
    appointment: {
      id: appointment.id,
      scheduled_at: appointment.scheduled_at,
      appointment_type_name: apptTypeName ?? null,
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
      is_onboarding_demo: isOnboardingDemo,
      session_entry_token: sessionEntryToken,
      session_id: sessionId,
    },
  };
}
