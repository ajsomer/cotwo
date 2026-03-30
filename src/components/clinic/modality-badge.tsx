import { Video, User } from "lucide-react";
import { Tooltip } from "@/components/ui/tooltip";
import type { AppointmentModality } from "@/lib/supabase/types";

interface ModalityBadgeProps {
  modality: AppointmentModality | null;
}

export function ModalityBadge({ modality }: ModalityBadgeProps) {
  if (!modality) return null;

  if (modality === "telehealth") {
    return (
      <Tooltip content="Telehealth">
        <span className="inline-flex items-center justify-center w-[26px] h-[26px] flex-shrink-0">
          <Video size={15} className="text-gray-400" strokeWidth={1.75} />
        </span>
      </Tooltip>
    );
  }

  return (
    <Tooltip content="In-person">
      <span className="inline-flex items-center justify-center w-[26px] h-[26px] flex-shrink-0">
        <User size={15} className="text-gray-400" strokeWidth={1.75} />
      </span>
    </Tooltip>
  );
}
