import { postJson } from '@/lib/api-client';

/** One reminder row in the appointment-type editor. */
export interface ReminderState {
  id: string | null; // existing block ID, null for new
  offset_days: number;
  message_body: string;
}

/** Everything the appointment-type editor edits, as one form object. */
export interface AppointmentTypeFormState {
  name: string;
  durationMinutes: number | '';
  modality: string;
  pmsSyncEnabled: boolean;
  defaultFeeDollars: string;
  includesCardCapture: boolean;
  includesConsent: boolean;
  selectedFormIds: string[];
  initialMessage: string;
  reminders: ReminderState[];
  atRiskAfterDays: number | '';
  overdueAfterDays: number | '';
}

export function validateAppointmentTypeForm(
  form: AppointmentTypeFormState
): string | null {
  if (!form.name.trim()) return 'Name is required';
  if (form.durationMinutes === '' || form.durationMinutes == null)
    return 'Duration is required';
  if (form.durationMinutes < 0) return 'Duration must be non-negative';
  if (
    form.atRiskAfterDays &&
    form.overdueAfterDays &&
    Number(form.overdueAfterDays) <= Number(form.atRiskAfterDays)
  ) {
    return 'Overdue threshold must be greater than at-risk threshold';
  }
  const offsets = form.reminders.map((r) => r.offset_days);
  if (new Set(offsets).size !== offsets.length) {
    return 'Reminder offsets must be unique';
  }
  for (const r of form.reminders) {
    if (r.offset_days <= 0) return 'Reminder offsets must be positive';
  }
  return null;
}

interface SaveAppointmentTypeInput {
  orgId: string;
  appointmentTypeId: string | null;
  /** PMS-imported types also persist the confirmed modality + sync toggle. */
  isPmsSynced: boolean;
  form: AppointmentTypeFormState;
}

/**
 * The editor's two-step save as one mutation: configure the type (and its
 * intake package / reminders / thresholds), then — for PMS-imported types —
 * persist the confirmed modality + sync toggle to the PMS link (this is what
 * gates run-sheet sync, §025). Failures of either step surface as the
 * returned error.
 */
export async function saveAppointmentType({
  orgId,
  appointmentTypeId,
  isPmsSynced,
  form,
}: SaveAppointmentTypeInput): Promise<{ ok: true } | { ok: false; error: string }> {
  const result = await postJson<{ error?: string }>(
    '/api/appointment-types/configure',
    {
      appointment_type_id: appointmentTypeId,
      org_id: orgId,
      name: form.name.trim(),
      duration_minutes: form.durationMinutes === '' ? null : form.durationMinutes,
      modality: form.modality,
      default_fee_cents: form.defaultFeeDollars
        ? Math.round(parseFloat(form.defaultFeeDollars) * 100)
        : 0,
      terminal_type: 'run_sheet',
      includes_card_capture: form.includesCardCapture,
      includes_consent: form.includesConsent,
      form_ids: form.selectedFormIds,
      initial_message: form.initialMessage,
      reminders: form.reminders.map((r) => ({
        id: r.id,
        offset_days: r.offset_days,
        message_body: r.message_body,
      })),
      at_risk_after_days: form.atRiskAfterDays || null,
      overdue_after_days: form.overdueAfterDays || null,
    },
    'Failed to save'
  );

  // The configure route can also report an error in a 200 body.
  const saveError = result.ok ? result.data?.error : result.error;
  if (saveError) return { ok: false, error: saveError };

  if (isPmsSynced && appointmentTypeId) {
    const confirmResult = await postJson<{ error?: string }>(
      '/api/pms/confirm-type',
      {
        appointmentTypeId,
        confirmedModality: form.modality,
        syncEnabled: form.pmsSyncEnabled,
      },
      'Saved, but failed to update the PMS sync settings'
    );
    const confirmError = confirmResult.ok
      ? confirmResult.data?.error
      : confirmResult.error;
    if (confirmError) return { ok: false, error: confirmError };
  }

  return { ok: true };
}
