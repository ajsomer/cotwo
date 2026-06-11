"use client";

import { useState } from "react";
import { SlideOver } from "@/components/ui/slide-over";
import { Button } from "@/components/ui/button";
import { CloseButton } from "@/components/ui/close-button";
import { ConfirmModal } from "@/components/ui/modal";
import { useClinicStore } from "@/stores/clinic-store";
import { useOrg } from "@/hooks/useOrg";
import type { AppointmentTypeRow } from "@/stores/clinic-store";
import {
  saveAppointmentType,
  validateAppointmentTypeForm,
  type AppointmentTypeFormState,
} from "@/lib/settings/appointment-types";
import {
  DetailsSection,
  IntakePackageSection,
  RemindersSection,
  UrgencySection,
} from "./appointment-type-sections";

interface AppointmentTypeEditorProps {
  appointmentType: AppointmentTypeRow | null; // null = new
  onClose: () => void;
  onSaved: () => void;
}

const DEFAULT_REMINDER_MESSAGE =
  "Hi {patient_first_name}, just a reminder to complete your intake for your upcoming appointment. Tap here to continue: {link}";

const DEFAULT_INITIAL_MESSAGE =
  "Hi {patient_first_name}, please complete your intake before your appointment at {clinic_name}: {link}";

export function AppointmentTypeEditor({
  appointmentType,
  onClose,
  onSaved,
}: AppointmentTypeEditorProps) {
  const { org } = useOrg();
  const forms = useClinicStore((s) => s.forms);
  const preTemplates = useClinicStore((s) => s.preWorkflowTemplates);
  const preBlocks = useClinicStore((s) => s.preWorkflowBlocks);
  const isNew = !appointmentType;
  const isPmsSynced = appointmentType?.source === "pms";

  // The whole form as one object, initialised from the store's existing
  // template/blocks config.
  const [form, setForm] = useState<AppointmentTypeFormState>(() => {
    const existingTemplateId = appointmentType?.pre_workflow_template_id ?? null;
    const existingTemplate = existingTemplateId ? preTemplates[existingTemplateId] : null;
    const existingBlocks = existingTemplateId ? (preBlocks[existingTemplateId] ?? []) : [];

    const existingIntakeBlock = existingBlocks.find((b) => b.action_type === "intake_package");
    const existingIntakeConfig = (existingIntakeBlock?.config ?? {}) as {
      includes_card_capture?: boolean;
      includes_consent?: boolean;
      form_ids?: string[];
      message_body?: string;
    };
    const existingReminderBlocks = existingBlocks.filter(
      (b) => b.action_type === "intake_reminder"
    );

    return {
      name: appointmentType?.name ?? "",
      durationMinutes: appointmentType?.duration_minutes ?? 30,
      modality: appointmentType?.modality ?? "telehealth",
      // PMS sync toggle (only for PMS-imported types). When on + modality is
      // telehealth, the type's appointments sync to the run sheet (room comes
      // from the practitioner mapping). §025
      pmsSyncEnabled: appointmentType?.pms_sync_enabled ?? false,
      defaultFeeDollars: appointmentType?.default_fee_cents
        ? (appointmentType.default_fee_cents / 100).toFixed(2)
        : "",
      includesCardCapture: existingIntakeConfig.includes_card_capture ?? false,
      includesConsent: existingIntakeConfig.includes_consent ?? false,
      selectedFormIds: existingIntakeConfig.form_ids ?? [],
      initialMessage: existingIntakeConfig.message_body ?? DEFAULT_INITIAL_MESSAGE,
      reminders: existingReminderBlocks.map((b) => {
        const config = (b.config ?? {}) as { offset_days?: number; message_body?: string };
        return {
          id: b.id,
          offset_days: config.offset_days ?? Math.round(b.offset_minutes / (24 * 60)),
          message_body: config.message_body ?? DEFAULT_REMINDER_MESSAGE,
        };
      }),
      atRiskAfterDays: existingTemplate?.at_risk_after_days ?? "",
      overdueAfterDays: existingTemplate?.overdue_after_days ?? "",
    };
  });

  const update = (patch: Partial<AppointmentTypeFormState>) => {
    setForm((prev) => ({ ...prev, ...patch }));
  };

  // Section expand/collapse state
  const allExpanded = isNew || !appointmentType?.pre_workflow_template_id;
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    details: allExpanded,
    intakePackage: allExpanded,
    reminders: allExpanded,
    urgency: allExpanded,
  });

  // Save state
  const [saving, setSaving] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Plain function (not useCallback): every call site wraps it in an inline
  // arrow anyway, and the React Compiler memoizes the component.
  const toggleSection = (key: string) => {
    setExpandedSections((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handleSave = async () => {
    const validationError = validateAppointmentTypeForm(form);
    if (validationError) {
      setError(validationError);
      return;
    }

    setSaving(true);
    setError(null);

    const result = await saveAppointmentType({
      orgId: org?.id ?? "",
      appointmentTypeId: appointmentType?.id ?? null,
      isPmsSynced,
      form,
    });
    setSaving(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }

    onSaved();
  };

  const handleClose = () => {
    // TODO: detect actual dirty state for unsaved changes banner
    onClose();
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
                {isNew ? "Create new appointment type" : appointmentType.name}
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
            <CloseButton
              onClick={handleClose}
              className="p-1 text-gray-500 hover:text-gray-800 rounded"
            />
          </div>
        </div>
      }
    >
      <div className="flex h-full flex-col">
        {/* Scrollable body with sections */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          <DetailsSection
            form={form}
            update={update}
            expanded={expandedSections.details}
            onToggle={() => toggleSection("details")}
            isPmsSynced={isPmsSynced}
            isNew={isNew}
          />

          <IntakePackageSection
            form={form}
            update={update}
            expanded={expandedSections.intakePackage}
            onToggle={() => toggleSection("intakePackage")}
            forms={forms}
          />

          <RemindersSection
            form={form}
            update={update}
            expanded={expandedSections.reminders}
            onToggle={() => toggleSection("reminders")}
            defaultReminderMessage={DEFAULT_REMINDER_MESSAGE}
          />

          <UrgencySection
            form={form}
            update={update}
            expanded={expandedSections.urgency}
            onToggle={() => toggleSection("urgency")}
          />

          {error && (
            <p className="text-xs text-red-500 px-1">{error}</p>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-gray-200 px-5 py-3 flex items-center justify-between">
          <button
            type="button"
            onClick={() => {
              if (isNew) {
                onClose();
                return;
              }
              setConfirmingDelete(true);
            }}
            className="text-sm text-red-500 hover:text-red-700"
          >
            {isPmsSynced ? "Archive" : isNew ? "Discard" : "Delete"}
          </button>
          <div className="flex gap-2">
            <Button type="button" variant="secondary" onClick={handleClose}>
              Cancel
            </Button>
            <Button type="button" onClick={handleSave} disabled={saving}>
              {saving ? "Saving..." : isNew ? "Create appointment type" : "Save changes"}
            </Button>
          </div>
        </div>
      </div>

      <ConfirmModal
        open={confirmingDelete}
        title="Delete this appointment type?"
        message="This cannot be undone."
        confirmLabel="Delete"
        destructive
        onConfirm={async () => {
          if (!appointmentType) return;
          setConfirmingDelete(false);
          try {
            const res = await fetch(`/api/appointment-types?id=${appointmentType.id}`, {
              method: "DELETE",
            });
            if (!res.ok) {
              const data = await res.json();
              setError(data.error ?? "Failed to delete appointment type");
              return;
            }
            onSaved();
          } catch (e) {
            console.error("Failed to delete:", e);
            setError("Failed to delete appointment type");
          }
        }}
        onCancel={() => setConfirmingDelete(false)}
      />
    </SlideOver>
  );
}
