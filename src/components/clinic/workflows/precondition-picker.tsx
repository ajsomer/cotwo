"use client";

import type {
  PreconditionConfig,
  WorkflowDirection,
} from "@/lib/workflows/types";
import { PRECONDITION_OPTIONS } from "@/lib/workflows/types";

interface PreconditionPickerProps {
  direction: WorkflowDirection;
  value: PreconditionConfig;
  forms: { id: string; name: string }[];
  onChange: (value: PreconditionConfig) => void;
}

/**
 * Dropdown picker for action preconditions.
 * Shows "Always fires" by default. Some options (like "Form not completed")
 * show a nested form picker when selected.
 */
export function PreconditionPicker({
  direction,
  value,
  forms,
  onChange,
}: PreconditionPickerProps) {
  const isPre = direction === "pre_appointment";
  const options = PRECONDITION_OPTIONS.filter(
    (o) => o.direction === "both" || (isPre ? o.direction === "pre" : o.direction === "post")
  );

  const selectedType = value?.type ?? "always";

  const handleTypeChange = (typeValue: string) => {
    if (typeValue === "always") {
      onChange(null);
      return;
    }

    const option = options.find((o) => o.value?.type === typeValue);
    if (!option) return;

    if (option.needsFormPicker) {
      onChange({ type: "form_not_completed", form_id: forms[0]?.id ?? "" });
    } else {
      onChange(option.value);
    }
  };

  const handleFormChange = (formId: string) => {
    onChange({ type: "form_not_completed", form_id: formId });
  };

  return (
    <div className="space-y-2">
      <select
        value={selectedType}
        onChange={(e) => handleTypeChange(e.target.value)}
        className="w-full rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-800 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
      >
        <option value="always">Always fires</option>
        {options
          .filter((o) => o.value !== null)
          .map((o) => (
            <option key={o.value!.type} value={o.value!.type}>
              {o.label}
            </option>
          ))}
      </select>

      {value?.type === "form_not_completed" && (
        <select
          value={value.form_id}
          onChange={(e) => handleFormChange(e.target.value)}
          className="w-full rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-800 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
        >
          {forms.length === 0 && (
            <option value="">No forms available</option>
          )}
          {forms.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
