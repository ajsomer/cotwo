"use client";

import { Button } from "@/components/ui/button";
import { getActionConfig } from "@/lib/runsheet/derived-state";
import type { DerivedDisplayState, AppointmentModality } from "@/lib/supabase/types";

interface ActionButtonProps {
  state: DerivedDisplayState;
  modality: AppointmentModality | null;
  sessionId: string;
  onAction: (sessionId: string, action: string) => void;
}

const variantMap = {
  red: "danger",
  amber: "accent",
  teal: "primary",
  blue: "blue",
} as const;

export function ActionButton({
  state,
  modality,
  sessionId,
  onAction,
}: ActionButtonProps) {
  const config = getActionConfig(state, modality);

  if (!config) return null;

  return (
    <Button
      variant={variantMap[config.variant]}
      size="sm"
      onClick={(e) => {
        e.stopPropagation();
        onAction(sessionId, config.action);
      }}
    >
      {config.label}
    </Button>
  );
}
