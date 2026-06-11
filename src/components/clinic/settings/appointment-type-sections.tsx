"use client";

import { useState } from "react";
import { CollapsibleSection } from "@/components/ui/collapsible-section";
import { Toggle } from "@/components/ui/toggle";
import { CloseButton } from "@/components/ui/close-button";
import { TextInput } from "@/components/ui/input";
import type { AppointmentTypeFormState } from "@/lib/settings/appointment-types";

/**
 * The appointment-type editor's four CollapsibleSection bodies. Each section
 * receives the whole form object plus a patch updater; section-local UI
 * state (form picker open/closed) lives here, not in the editor.
 */

interface SectionProps {
  form: AppointmentTypeFormState;
  update: (patch: Partial<AppointmentTypeFormState>) => void;
  expanded: boolean;
  onToggle: () => void;
}

// ---------------------------------------------------------------------------
// Details
// ---------------------------------------------------------------------------

export function DetailsSection({
  form,
  update,
  expanded,
  onToggle,
  isPmsSynced,
  isNew,
}: SectionProps & { isPmsSynced: boolean; isNew: boolean }) {
  const summary = (() => {
    if (!form.name) return "Not set";
    const feeDisplay = form.defaultFeeDollars
      ? `$${parseFloat(form.defaultFeeDollars).toFixed(2)}`
      : "$0.00";
    return `${form.durationMinutes || "—"} min ${form.modality} · ${feeDisplay}`;
  })();

  return (
    <CollapsibleSection
      title="Details"
      summary={summary}
      expanded={expanded}
      onToggle={onToggle}
    >
      <div className="grid grid-cols-2 gap-3 mt-2">
        {/* Name (only editable for non-PMS, and in expanded section for existing) */}
        <div className="col-span-2">
          <label className="block text-xs font-medium text-gray-700 mb-1">
            Name {isPmsSynced && <span className="text-gray-400">(synced)</span>}
          </label>
          <TextInput
            type="text"
            value={form.name}
            onChange={(e) => update({ name: e.target.value })}
            disabled={isPmsSynced}
            autoFocus={isNew}
            placeholder="e.g. Initial Consultation"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">
            Duration (min) {isPmsSynced && <span className="text-gray-400">(synced)</span>}
          </label>
          <TextInput
            type="number"
            value={form.durationMinutes}
            onChange={(e) =>
              update({
                durationMinutes: e.target.value ? parseInt(e.target.value) : "",
              })
            }
            disabled={isPmsSynced}
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Modality</label>
          <select
            value={form.modality}
            onChange={(e) => update({ modality: e.target.value })}
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-teal-500 focus:ring-1 focus:ring-teal-500 outline-none disabled:bg-gray-50 disabled:text-gray-500"
          >
            <option value="telehealth">Telehealth</option>
            <option value="in_person">In-person</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Default fee ($)</label>
          <TextInput
            type="number"
            value={form.defaultFeeDollars}
            onChange={(e) => update({ defaultFeeDollars: e.target.value })}
            step="0.01"
            min="0"
            placeholder="0.00"
          />
        </div>
      </div>

      {/* PMS sync — only for imported types. Sync to the run sheet when
          on + telehealth; room comes from the practitioner mapping. §025 */}
      {isPmsSynced && (
        <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50/50 p-3">
          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={form.pmsSyncEnabled}
              onChange={(e) => update({ pmsSyncEnabled: e.target.checked })}
              className="mt-0.5"
            />
            <span className="text-sm text-gray-800">
              Sync this type from the PMS to the run sheet
              <span className="block text-xs text-gray-500 mt-0.5">
                Appointments of this type appear on the run sheet when it&apos;s
                set to Telehealth and the booked practitioner is mapped to a
                room (Settings → Integrations).
              </span>
            </span>
          </label>
        </div>
      )}
    </CollapsibleSection>
  );
}

// ---------------------------------------------------------------------------
// Intake package
// ---------------------------------------------------------------------------

export function IntakePackageSection({
  form,
  update,
  expanded,
  onToggle,
  forms,
}: SectionProps & { forms: Array<{ id: string; name: string }> }) {
  const [formPickerOpen, setFormPickerOpen] = useState(false);

  const summary = (() => {
    const items: string[] = [];
    if (form.includesCardCapture) items.push("card on file");
    if (form.includesConsent) items.push("consent");
    if (form.selectedFormIds.length > 0) {
      items.push(
        `${form.selectedFormIds.length} form${form.selectedFormIds.length === 1 ? "" : "s"}`
      );
    }
    if (items.length === 0) return "1 item · contact creation only";
    return `${items.length + 1} items · ${items.join(", ")}`;
  })();

  const toggleForm = (formId: string) => {
    update({
      selectedFormIds: form.selectedFormIds.includes(formId)
        ? form.selectedFormIds.filter((id) => id !== formId)
        : [...form.selectedFormIds, formId],
    });
  };

  return (
    <CollapsibleSection
      title="Intake package"
      summary={summary}
      expanded={expanded}
      onToggle={onToggle}
    >
      <p className="text-xs text-gray-500 mb-3 mt-1">What should the patient complete before the appointment?</p>
      <div className="space-y-2">
        {/* Locked: Verify identity */}
        <div className="flex items-center justify-between p-3 rounded-lg bg-gray-50 border border-gray-200">
          <div className="flex items-center gap-2">
            <svg className="h-4 w-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
            <div>
              <div className="text-sm font-medium text-gray-700">Verify identity and confirm contact</div>
              <div className="text-xs text-gray-500">The patient verifies their phone number and confirms they&apos;re the contact you scheduled. Contact records are captured when you add the patient, not in the journey.</div>
            </div>
          </div>
          <span className="text-xs text-gray-500 bg-gray-200 rounded px-2 py-0.5 flex-shrink-0">Required</span>
        </div>

        {/* Card on file */}
        <div className="flex items-center justify-between p-3 rounded-lg border border-gray-200">
          <div>
            <div className="text-sm font-medium text-gray-700">Store a card on file</div>
            <div className="text-xs text-gray-500">The patient stores a payment method so you can charge after the session.</div>
          </div>
          <Toggle
            checked={form.includesCardCapture}
            onChange={(checked) => update({ includesCardCapture: checked })}
            aria-label="Store a card on file"
          />
        </div>

        {/* Consent */}
        <div className="flex items-center justify-between p-3 rounded-lg border border-gray-200">
          <div>
            <div className="text-sm font-medium text-gray-700">Provide consent</div>
            <div className="text-xs text-gray-500">The patient agrees to your clinic&apos;s terms before the appointment.</div>
          </div>
          <Toggle
            checked={form.includesConsent}
            onChange={(checked) => update({ includesConsent: checked })}
            aria-label="Provide consent"
          />
        </div>

        {/* Forms */}
        <div className="p-3 rounded-lg border border-gray-200">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium text-gray-700">Fill out forms</div>
              <div className="text-xs text-gray-500">
                {form.selectedFormIds.length === 0
                  ? "No forms selected"
                  : `${form.selectedFormIds.length} form${form.selectedFormIds.length === 1 ? "" : "s"} selected`}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setFormPickerOpen(!formPickerOpen)}
              className="text-xs font-medium text-teal-600 hover:text-teal-700 border border-teal-200 rounded px-2 py-1"
            >
              {formPickerOpen ? "Done" : "Add form"}
            </button>
          </div>

          {/* Selected forms list */}
          {form.selectedFormIds.length > 0 && (
            <div className="mt-2 space-y-1">
              {form.selectedFormIds.map((formId) => {
                const f = forms.find((x) => x.id === formId);
                return (
                  <div key={formId} className="flex items-center justify-between bg-gray-50 rounded px-2 py-1.5">
                    <span className="text-xs text-gray-700">{f?.name ?? formId}</span>
                    <CloseButton
                      onClick={() => toggleForm(formId)}
                      className="text-gray-400 hover:text-gray-600"
                      iconClassName="h-3.5 w-3.5"
                      aria-label={`Remove ${f?.name ?? "form"}`}
                    />
                  </div>
                );
              })}
            </div>
          )}

          {/* Inline form picker */}
          {formPickerOpen && (
            <div className="mt-2 border border-gray-200 rounded-lg p-2 bg-white">
              <p className="text-xs font-medium text-gray-600 mb-2">Select forms from your library</p>
              {forms.length === 0 ? (
                <p className="text-xs text-gray-400 py-2">No published forms available.</p>
              ) : (
                <div className="max-h-40 overflow-y-auto space-y-1">
                  {forms.map((f) => (
                    <label key={f.id} className="flex items-center gap-2 py-1 px-1 hover:bg-gray-50 rounded cursor-pointer">
                      <input
                        type="checkbox"
                        checked={form.selectedFormIds.includes(f.id)}
                        onChange={() => toggleForm(f.id)}
                        className="rounded border-gray-300 text-teal-500 focus:ring-teal-500"
                      />
                      <span className="text-xs text-gray-700">{f.name}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <p className="text-xs text-gray-500 mt-3">
        The patient will complete {1 + (form.includesCardCapture ? 1 : 0) + (form.includesConsent ? 1 : 0) + form.selectedFormIds.length} items in one journey.
      </p>

      <div className="mt-4 border-t border-gray-100 pt-4">
        <label className="block text-xs font-medium text-gray-700 mb-1">
          Initial SMS
        </label>
        <p className="text-[11px] text-gray-500 mb-2">
          The first message the patient receives, inviting them to complete
          their intake.
        </p>
        <textarea
          value={form.initialMessage}
          onChange={(e) => update({ initialMessage: e.target.value })}
          rows={3}
          className="w-full rounded border border-gray-200 px-2 py-1.5 text-xs focus:border-teal-500 focus:ring-1 focus:ring-teal-500 outline-none resize-none"
        />
        <div className="flex items-center justify-between mt-1">
          <span className="text-[10px] text-gray-400">
            {"{patient_first_name}"}, {"{link}"}, {"{clinic_name}"}
          </span>
          <span className="text-[10px] text-gray-400">
            {form.initialMessage.length} / 160
          </span>
        </div>
      </div>
    </CollapsibleSection>
  );
}

// ---------------------------------------------------------------------------
// Reminders
// ---------------------------------------------------------------------------

export function RemindersSection({
  form,
  update,
  expanded,
  onToggle,
  defaultReminderMessage,
}: SectionProps & { defaultReminderMessage: string }) {
  const { reminders } = form;

  const summary = (() => {
    if (reminders.length === 0) return "No reminders configured";
    if (reminders.length === 1) return `1 reminder at day ${reminders[0].offset_days}`;
    return `2 reminders at day ${reminders[0].offset_days} and day ${reminders[1].offset_days}`;
  })();

  const addReminder = () => {
    if (reminders.length >= 2) return;
    const defaultOffset = reminders.length === 0 ? 3 : 5;
    update({
      reminders: [
        ...reminders,
        { id: null, offset_days: defaultOffset, message_body: defaultReminderMessage },
      ],
    });
  };

  const removeReminder = (index: number) => {
    update({ reminders: reminders.filter((_, i) => i !== index) });
  };

  const changeReminder = (
    index: number,
    field: "offset_days" | "message_body",
    value: number | string
  ) => {
    update({
      reminders: reminders.map((r, i) => (i === index ? { ...r, [field]: value } : r)),
    });
  };

  return (
    <CollapsibleSection
      title="Reminders"
      summary={summary}
      expanded={expanded}
      onToggle={onToggle}
    >
      <p className="text-xs text-gray-500 mb-3 mt-1">
        Send up to 2 reminders if the patient hasn&apos;t completed their intake package.
      </p>

      {reminders.length === 0 ? (
        <div className="text-center py-4">
          <p className="text-xs text-gray-500 mb-3">
            No reminders configured. The patient will only receive the initial intake package SMS.
          </p>
          <button
            type="button"
            onClick={addReminder}
            className="text-sm font-medium text-teal-600 hover:text-teal-700 border border-teal-200 rounded-lg px-4 py-2"
          >
            Add reminder
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {reminders.map((reminder, index) => (
            <div key={index} className="border border-gray-200 rounded-lg p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-gray-700">Reminder {index + 1}</span>
                <button
                  type="button"
                  onClick={() => removeReminder(index)}
                  className="text-gray-400 hover:text-red-500"
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              </div>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs text-gray-600">Send</span>
                <input
                  type="number"
                  value={reminder.offset_days}
                  onChange={(e) => changeReminder(index, "offset_days", parseInt(e.target.value) || 0)}
                  min={1}
                  className="w-16 rounded border border-gray-200 px-2 py-1 text-xs focus:border-teal-500 focus:ring-1 focus:ring-teal-500 outline-none"
                />
                <span className="text-xs text-gray-600">days after the intake package is sent</span>
              </div>
              <div>
                <label className="block text-xs text-gray-600 mb-1">Message</label>
                <textarea
                  value={reminder.message_body}
                  onChange={(e) => changeReminder(index, "message_body", e.target.value)}
                  rows={3}
                  className="w-full rounded border border-gray-200 px-2 py-1.5 text-xs focus:border-teal-500 focus:ring-1 focus:ring-teal-500 outline-none resize-none"
                />
                <div className="flex items-center justify-between mt-1">
                  <span className="text-[10px] text-gray-400">
                    {"{patient_first_name}"}, {"{link}"}, {"{clinic_name}"}
                  </span>
                  <span className="text-[10px] text-gray-400">
                    {reminder.message_body.length} / 160
                  </span>
                </div>
              </div>
            </div>
          ))}

          <button
            type="button"
            onClick={addReminder}
            disabled={reminders.length >= 2}
            className="w-full rounded-lg border border-gray-200 py-2 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:text-gray-400 disabled:cursor-not-allowed"
          >
            {reminders.length >= 2 ? "Add reminder (maximum reached)" : "Add reminder"}
          </button>
        </div>
      )}
    </CollapsibleSection>
  );
}

// ---------------------------------------------------------------------------
// Urgency
// ---------------------------------------------------------------------------

export function UrgencySection({ form, update, expanded, onToggle }: SectionProps) {
  const summary = (() => {
    if (form.atRiskAfterDays && form.overdueAfterDays) {
      return `At-risk ${form.atRiskAfterDays} days · overdue ${form.overdueAfterDays} days`;
    }
    if (form.atRiskAfterDays) return `At-risk ${form.atRiskAfterDays} days · no overdue threshold`;
    if (form.overdueAfterDays) return `Overdue ${form.overdueAfterDays} days · no at-risk threshold`;
    return "Using system defaults only";
  })();

  return (
    <CollapsibleSection
      title="Urgency"
      summary={summary}
      expanded={expanded}
      onToggle={onToggle}
    >
      <p className="text-xs text-gray-500 mb-3 mt-1">
        When should an incomplete package be flagged on your readiness dashboard?
      </p>

      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-amber-500 flex-shrink-0" />
          <span className="text-xs text-gray-700 whitespace-nowrap">Mark as at-risk</span>
          <input
            type="number"
            value={form.atRiskAfterDays}
            onChange={(e) =>
              update({ atRiskAfterDays: e.target.value ? parseInt(e.target.value) : "" })
            }
            min={1}
            placeholder="—"
            className="w-16 rounded border border-gray-200 px-2 py-1 text-xs focus:border-teal-500 focus:ring-1 focus:ring-teal-500 outline-none"
          />
          <span className="text-xs text-gray-600">days after sent, if still incomplete</span>
        </div>

        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-red-500 flex-shrink-0" />
          <span className="text-xs text-gray-700 whitespace-nowrap">Mark as overdue</span>
          <input
            type="number"
            value={form.overdueAfterDays}
            onChange={(e) =>
              update({ overdueAfterDays: e.target.value ? parseInt(e.target.value) : "" })
            }
            min={1}
            placeholder="—"
            className="w-16 rounded border border-gray-200 px-2 py-1 text-xs focus:border-teal-500 focus:ring-1 focus:ring-teal-500 outline-none"
          />
          <span className="text-xs text-gray-600">days after sent, if still incomplete</span>
        </div>
      </div>

      <div className="mt-3 rounded-lg bg-blue-50 border border-blue-200 px-3 py-2.5">
        <p className="text-xs text-blue-800">
          For run-sheet appointments, Coviu will always mark the package as at-risk 2 days before the appointment and overdue 1 day before, regardless of the thresholds above.
        </p>
      </div>
    </CollapsibleSection>
  );
}
