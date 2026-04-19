"use client";

import { useState, useCallback } from "react";
import { SlideOver } from "@/components/ui/slide-over";
import { CollapsibleSection } from "@/components/ui/collapsible-section";
import { useClinicStore } from "@/stores/clinic-store";
import { useOrg } from "@/hooks/useOrg";
import type { AppointmentTypeRow } from "@/stores/clinic-store";

interface AppointmentTypeEditorProps {
  appointmentType: AppointmentTypeRow | null; // null = new
  forceTerminalType?: "run_sheet" | "collection_only";
  onClose: () => void;
  onSaved: () => void;
}

interface ReminderState {
  id: string | null; // existing block ID, null for new
  offset_days: number;
  message_body: string;
}

const DEFAULT_REMINDER_MESSAGE =
  "Hi {patient_first_name}, just a reminder to complete your intake for your upcoming appointment. Tap here to continue: {link}";

export function AppointmentTypeEditor({
  appointmentType,
  forceTerminalType,
  onClose,
  onSaved,
}: AppointmentTypeEditorProps) {
  const { org } = useOrg();
  const forms = useClinicStore((s) => s.forms);
  const preTemplates = useClinicStore((s) => s.preWorkflowTemplates);
  const preBlocks = useClinicStore((s) => s.preWorkflowBlocks);
  const isNew = !appointmentType;
  const isPmsSynced = appointmentType?.source === "pms";

  // Load existing config from store
  const existingTemplateId = appointmentType?.pre_workflow_template_id ?? null;
  const existingTemplate = existingTemplateId ? preTemplates[existingTemplateId] : null;
  const existingBlocks = existingTemplateId ? (preBlocks[existingTemplateId] ?? []) : [];

  const existingIntakeBlock = existingBlocks.find((b) => b.action_type === "intake_package");
  const existingIntakeConfig = (existingIntakeBlock?.config ?? {}) as {
    includes_card_capture?: boolean;
    includes_consent?: boolean;
    form_ids?: string[];
  };
  const existingReminderBlocks = existingBlocks.filter((b) => b.action_type === "intake_reminder");

  // Section expand/collapse state
  const allExpanded = isNew || (!appointmentType?.pre_workflow_template_id);
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    details: allExpanded,
    intakePackage: allExpanded,
    reminders: allExpanded,
    urgency: allExpanded,
  });

  // Form state — Section 1: Details
  const [name, setName] = useState(appointmentType?.name ?? "");
  const [durationMinutes, setDurationMinutes] = useState<number | "">(appointmentType?.duration_minutes ?? 30);
  const [modality, setModality] = useState(appointmentType?.modality ?? "telehealth");
  const [defaultFeeDollars, setDefaultFeeDollars] = useState(
    appointmentType?.default_fee_cents ? (appointmentType.default_fee_cents / 100).toFixed(2) : ""
  );

  // Terminal type: determined by creation context or existing data, no longer user-editable
  const [terminalType] = useState<"run_sheet" | "collection_only">(
    forceTerminalType ?? appointmentType?.terminal_type ?? "run_sheet"
  );

  // Section 3: Intake package — initialize from existing config
  const [includesCardCapture, setIncludesCardCapture] = useState(
    existingIntakeConfig.includes_card_capture ?? false
  );
  const [includesConsent, setIncludesConsent] = useState(
    existingIntakeConfig.includes_consent ?? false
  );
  const [selectedFormIds, setSelectedFormIds] = useState<string[]>(
    existingIntakeConfig.form_ids ?? []
  );
  const [formPickerOpen, setFormPickerOpen] = useState(false);

  // Section 4: Reminders — initialize from existing reminder blocks
  const [reminders, setReminders] = useState<ReminderState[]>(
    existingReminderBlocks.map((b) => {
      const config = (b.config ?? {}) as { offset_days?: number; message_body?: string };
      return {
        id: b.id,
        offset_days: config.offset_days ?? Math.round(b.offset_minutes / (24 * 60)),
        message_body: config.message_body ?? DEFAULT_REMINDER_MESSAGE,
      };
    })
  );

  // Section 5: Urgency — initialize from existing template thresholds
  const [atRiskAfterDays, setAtRiskAfterDays] = useState<number | "">(
    existingTemplate?.at_risk_after_days ?? ""
  );
  const [overdueAfterDays, setOverdueAfterDays] = useState<number | "">(
    existingTemplate?.overdue_after_days ?? ""
  );

  // Save state
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showDiscardBanner, setShowDiscardBanner] = useState(false);

  const isCollectionOnly = terminalType === "collection_only";

  const toggleSection = useCallback((key: string) => {
    setExpandedSections((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  // Summary lines for collapsed sections
  const detailsSummary = (() => {
    if (!name) return "Not set";
    const feeDisplay = defaultFeeDollars ? `$${parseFloat(defaultFeeDollars).toFixed(2)}` : "$0.00";
    if (isCollectionOnly) {
      return `Collection only · ${feeDisplay}`;
    }
    return `${durationMinutes || "—"} min ${modality} · ${feeDisplay}`;
  })();

  const intakePackageSummary = (() => {
    const items: string[] = [];
    if (includesCardCapture) items.push("card on file");
    if (includesConsent) items.push("consent");
    if (selectedFormIds.length > 0) {
      items.push(`${selectedFormIds.length} form${selectedFormIds.length === 1 ? "" : "s"}`);
    }
    if (items.length === 0) return "1 item · contact creation only";
    return `${items.length + 1} items · ${items.join(", ")}`;
  })();

  const remindersSummary = (() => {
    if (reminders.length === 0) return "No reminders configured";
    if (reminders.length === 1) return `1 reminder at day ${reminders[0].offset_days}`;
    return `2 reminders at day ${reminders[0].offset_days} and day ${reminders[1].offset_days}`;
  })();

  const urgencySummary = (() => {
    if (atRiskAfterDays && overdueAfterDays) {
      return `At-risk ${atRiskAfterDays} days · overdue ${overdueAfterDays} days`;
    }
    if (atRiskAfterDays) return `At-risk ${atRiskAfterDays} days · no overdue threshold`;
    if (overdueAfterDays) return `Overdue ${overdueAfterDays} days · no at-risk threshold`;
    return "Using system defaults only";
  })();

  // Validation
  const validate = (): string | null => {
    if (!name.trim()) return "Name is required";
    if (terminalType === "run_sheet") {
      if (!durationMinutes) return "Duration is required for run sheet types";
    }
    if (atRiskAfterDays && overdueAfterDays && Number(overdueAfterDays) <= Number(atRiskAfterDays)) {
      return "Overdue threshold must be greater than at-risk threshold";
    }
    const offsets = reminders.map((r) => r.offset_days);
    if (new Set(offsets).size !== offsets.length) {
      return "Reminder offsets must be unique";
    }
    for (const r of reminders) {
      if (r.offset_days <= 0) return "Reminder offsets must be positive";
    }
    return null;
  };

  const handleSave = async () => {
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const res = await fetch("/api/appointment-types/configure", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          appointment_type_id: appointmentType?.id ?? null,
          org_id: org?.id,
          name: name.trim(),
          duration_minutes: isCollectionOnly ? null : (durationMinutes || null),
          modality: isCollectionOnly ? null : modality,
          default_fee_cents: defaultFeeDollars ? Math.round(parseFloat(defaultFeeDollars) * 100) : 0,
          terminal_type: terminalType,
          includes_card_capture: includesCardCapture,
          includes_consent: includesConsent,
          form_ids: selectedFormIds,
          reminders: reminders.map((r) => ({
            id: r.id,
            offset_days: r.offset_days,
            message_body: r.message_body,
          })),
          at_risk_after_days: atRiskAfterDays || null,
          overdue_after_days: overdueAfterDays || null,
        }),
      });

      const result = await res.json();

      if (!res.ok || result.error) {
        setError(result.error ?? "Failed to save");
        return;
      }

      onSaved();
    } catch {
      setError("Network error");
    } finally {
      setSaving(false);
    }
  };

  const handleClose = () => {
    // TODO: detect actual dirty state for unsaved changes banner
    onClose();
  };

  const handleAddReminder = () => {
    if (reminders.length >= 2) return;
    const defaultOffset = reminders.length === 0 ? 3 : 5;
    setReminders([...reminders, { id: null, offset_days: defaultOffset, message_body: DEFAULT_REMINDER_MESSAGE }]);
  };

  const handleRemoveReminder = (index: number) => {
    setReminders(reminders.filter((_, i) => i !== index));
  };

  const handleReminderChange = (index: number, field: "offset_days" | "message_body", value: number | string) => {
    setReminders(reminders.map((r, i) => i === index ? { ...r, [field]: value } : r));
  };

  const handleToggleForm = (formId: string) => {
    setSelectedFormIds((prev) =>
      prev.includes(formId) ? prev.filter((id) => id !== formId) : [...prev, formId]
    );
  };

  return (
    <SlideOver
      open
      onClose={handleClose}
      title={isNew ? "New appointment type" : appointmentType.name}
      width="w-[620px]"
      customHeader={
        <div className="px-5 py-4 border-b border-gray-200">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold text-gray-800">
                {isNew
                  ? (isCollectionOnly ? "Create new collection" : "Create new appointment type")
                  : appointmentType.name}
              </h2>
              {isPmsSynced && (
                <div className="flex items-center gap-1 mt-0.5">
                  <svg className="h-3 w-3 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  <span className="text-xs text-gray-500">Synced from PMS</span>
                </div>
              )}
            </div>
            <button onClick={handleClose} className="p-1 text-gray-500 hover:text-gray-800 rounded" aria-label="Close">
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      }
    >
      <div className="flex h-full flex-col">
        {/* Scrollable body with sections */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">

          {/* Section 1: Details */}
          <CollapsibleSection
            title="Details"
            summary={detailsSummary}
            expanded={expandedSections.details}
            onToggle={() => toggleSection("details")}
          >
            <div className="grid grid-cols-2 gap-3 mt-2">
              {/* Name (only editable for non-PMS, and in expanded section for existing) */}
              <div className="col-span-2">
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Name {isPmsSynced && <span className="text-gray-400">(synced)</span>}
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  disabled={isPmsSynced}
                  autoFocus={isNew}
                  placeholder="e.g. Initial Consultation"
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-teal-500 focus:ring-1 focus:ring-teal-500 outline-none disabled:bg-gray-50 disabled:text-gray-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Duration (min) {isPmsSynced && <span className="text-gray-400">(synced)</span>}
                </label>
                <input
                  type="number"
                  value={durationMinutes}
                  onChange={(e) => setDurationMinutes(e.target.value ? parseInt(e.target.value) : "")}
                  disabled={isPmsSynced || isCollectionOnly}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-teal-500 focus:ring-1 focus:ring-teal-500 outline-none disabled:bg-gray-50 disabled:text-gray-500"
                />
                {isCollectionOnly && (
                  <p className="text-xs text-gray-400 mt-1">Not applicable for collection-only</p>
                )}
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Modality</label>
                <select
                  value={modality}
                  onChange={(e) => setModality(e.target.value)}
                  disabled={isCollectionOnly}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-teal-500 focus:ring-1 focus:ring-teal-500 outline-none disabled:bg-gray-50 disabled:text-gray-500"
                >
                  <option value="telehealth">Telehealth</option>
                  <option value="in_person">In-person</option>
                </select>
                {isCollectionOnly && (
                  <p className="text-xs text-gray-400 mt-1">Not applicable for collection-only</p>
                )}
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Default fee ($)</label>
                <input
                  type="number"
                  value={defaultFeeDollars}
                  onChange={(e) => setDefaultFeeDollars(e.target.value)}
                  step="0.01"
                  min="0"
                  placeholder="0.00"
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-teal-500 focus:ring-1 focus:ring-teal-500 outline-none"
                />
              </div>
            </div>
          </CollapsibleSection>

          {/* Section 2: Intake package */}
          <CollapsibleSection
            title="Intake package"
            summary={intakePackageSummary}
            expanded={expandedSections.intakePackage}
            onToggle={() => toggleSection("intakePackage")}
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
                <button
                  type="button"
                  onClick={() => setIncludesCardCapture(!includesCardCapture)}
                  className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors flex-shrink-0 ${
                    includesCardCapture ? "bg-teal-500" : "bg-gray-300"
                  }`}
                >
                  <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                    includesCardCapture ? "translate-x-4.5" : "translate-x-0.5"
                  }`} />
                </button>
              </div>

              {/* Consent */}
              <div className="flex items-center justify-between p-3 rounded-lg border border-gray-200">
                <div>
                  <div className="text-sm font-medium text-gray-700">Provide consent</div>
                  <div className="text-xs text-gray-500">The patient agrees to your clinic&apos;s terms before the appointment.</div>
                </div>
                <button
                  type="button"
                  onClick={() => setIncludesConsent(!includesConsent)}
                  className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors flex-shrink-0 ${
                    includesConsent ? "bg-teal-500" : "bg-gray-300"
                  }`}
                >
                  <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                    includesConsent ? "translate-x-4.5" : "translate-x-0.5"
                  }`} />
                </button>
              </div>

              {/* Forms */}
              <div className="p-3 rounded-lg border border-gray-200">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-medium text-gray-700">Fill out forms</div>
                    <div className="text-xs text-gray-500">
                      {selectedFormIds.length === 0
                        ? "No forms selected"
                        : `${selectedFormIds.length} form${selectedFormIds.length === 1 ? "" : "s"} selected`}
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
                {selectedFormIds.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {selectedFormIds.map((formId) => {
                      const form = forms.find((f) => f.id === formId);
                      return (
                        <div key={formId} className="flex items-center justify-between bg-gray-50 rounded px-2 py-1.5">
                          <span className="text-xs text-gray-700">{form?.name ?? formId}</span>
                          <button
                            type="button"
                            onClick={() => handleToggleForm(formId)}
                            className="text-gray-400 hover:text-gray-600"
                          >
                            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
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
                        {forms.map((form) => (
                          <label key={form.id} className="flex items-center gap-2 py-1 px-1 hover:bg-gray-50 rounded cursor-pointer">
                            <input
                              type="checkbox"
                              checked={selectedFormIds.includes(form.id)}
                              onChange={() => handleToggleForm(form.id)}
                              className="rounded border-gray-300 text-teal-500 focus:ring-teal-500"
                            />
                            <span className="text-xs text-gray-700">{form.name}</span>
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            <p className="text-xs text-gray-500 mt-3">
              The patient will complete {1 + (includesCardCapture ? 1 : 0) + (includesConsent ? 1 : 0) + selectedFormIds.length} items in one journey.
            </p>
          </CollapsibleSection>

          {/* Section 4: Reminders */}
          <CollapsibleSection
            title="Reminders"
            summary={remindersSummary}
            expanded={expandedSections.reminders}
            onToggle={() => toggleSection("reminders")}
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
                  onClick={handleAddReminder}
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
                        onClick={() => handleRemoveReminder(index)}
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
                        onChange={(e) => handleReminderChange(index, "offset_days", parseInt(e.target.value) || 0)}
                        min={1}
                        className="w-16 rounded border border-gray-200 px-2 py-1 text-xs focus:border-teal-500 focus:ring-1 focus:ring-teal-500 outline-none"
                      />
                      <span className="text-xs text-gray-600">days after the intake package is sent</span>
                    </div>
                    <div>
                      <label className="block text-xs text-gray-600 mb-1">Message</label>
                      <textarea
                        value={reminder.message_body}
                        onChange={(e) => handleReminderChange(index, "message_body", e.target.value)}
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
                  onClick={handleAddReminder}
                  disabled={reminders.length >= 2}
                  className="w-full rounded-lg border border-gray-200 py-2 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:text-gray-400 disabled:cursor-not-allowed"
                >
                  {reminders.length >= 2 ? "Add reminder (maximum reached)" : "Add reminder"}
                </button>
              </div>
            )}
          </CollapsibleSection>

          {/* Section 5: Dashboard urgency */}
          <CollapsibleSection
            title="Urgency"
            summary={urgencySummary}
            expanded={expandedSections.urgency}
            onToggle={() => toggleSection("urgency")}
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
                  value={atRiskAfterDays}
                  onChange={(e) => setAtRiskAfterDays(e.target.value ? parseInt(e.target.value) : "")}
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
                  value={overdueAfterDays}
                  onChange={(e) => setOverdueAfterDays(e.target.value ? parseInt(e.target.value) : "")}
                  min={1}
                  placeholder="—"
                  className="w-16 rounded border border-gray-200 px-2 py-1 text-xs focus:border-teal-500 focus:ring-1 focus:ring-teal-500 outline-none"
                />
                <span className="text-xs text-gray-600">days after sent, if still incomplete</span>
              </div>
            </div>

            {terminalType === "run_sheet" && (
              <div className="mt-3 rounded-lg bg-blue-50 border border-blue-200 px-3 py-2.5">
                <p className="text-xs text-blue-800">
                  For run-sheet appointments, Coviu will always mark the package as at-risk 2 days before the appointment and overdue 1 day before, regardless of the thresholds above.
                </p>
              </div>
            )}
          </CollapsibleSection>

          {error && (
            <p className="text-xs text-red-500 px-1">{error}</p>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-gray-200 px-5 py-3 flex items-center justify-between">
          <button
            type="button"
            onClick={async () => {
              if (isNew) {
                onClose();
                return;
              }
              if (!confirm("Delete this appointment type? This cannot be undone.")) return;
              try {
                const res = await fetch(`/api/appointment-types?id=${appointmentType.id}`, {
                  method: "DELETE",
                });
                if (!res.ok) {
                  const data = await res.json();
                  alert(data.error ?? "Failed to delete appointment type");
                  return;
                }
                onSaved();
              } catch (e) {
                console.error("Failed to delete:", e);
                alert("Failed to delete appointment type");
              }
            }}
            className="text-sm text-red-500 hover:text-red-700"
          >
            {isPmsSynced ? "Archive" : isNew ? "Discard" : "Delete"}
          </button>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleClose}
              className="rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="rounded-lg bg-teal-500 px-4 py-2 text-sm font-medium text-white hover:bg-teal-600 disabled:opacity-50"
            >
              {saving ? "Saving..." : isNew ? (isCollectionOnly ? "Create collection" : "Create appointment type") : "Save changes"}
            </button>
          </div>
        </div>
      </div>
    </SlideOver>
  );
}
