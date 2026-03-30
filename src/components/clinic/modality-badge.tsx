import type { AppointmentModality } from "@/lib/supabase/types";

interface ModalityBadgeProps {
  modality: AppointmentModality | null;
}

export function ModalityBadge({ modality }: ModalityBadgeProps) {
  if (!modality) return null;

  if (modality === "telehealth") {
    return (
      <span title="Telehealth" className="flex-shrink-0 leading-none inline-flex">
        <svg
          width="14"
          height="14"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-gray-400"
        >
          <rect x="1" y="3.5" width="10" height="7.5" rx="1.5" />
          <path d="M11 6.5l3.5-2v7l-3.5-2" />
        </svg>
      </span>
    );
  }

  return (
    <span title="In-person" className="flex-shrink-0 leading-none inline-flex">
      <svg
        width="14"
        height="14"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="text-gray-400"
      >
        <path d="M2 14V6l6-3.5L14 6v8" />
        <path d="M6 14v-4h4v4" />
        <path d="M2 14h12" />
      </svg>
    </span>
  );
}
