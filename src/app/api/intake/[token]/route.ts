import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';

/**
 * GET /api/intake/[token]
 * Fetch current state of an intake package journey.
 * No auth required — token-based access.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const supabase = createServiceClient();

  const { data: journey, error } = await supabase
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

  if (error || !journey) {
    return NextResponse.json({ error: 'Journey not found' }, { status: 404 });
  }

  return NextResponse.json({
    journey: {
      id: journey.id,
      journey_token: journey.journey_token,
      status: journey.status,
      patient_id: journey.patient_id,
      includes_card_capture: journey.includes_card_capture,
      includes_consent: journey.includes_consent,
      form_ids: journey.form_ids,
      card_captured_at: journey.card_captured_at,
      consent_completed_at: journey.consent_completed_at,
      forms_completed: journey.forms_completed,
    },
  });
}
