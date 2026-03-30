import { Badge } from "@/components/ui/badge";
import { getStatusBadgeConfig } from "@/lib/runsheet/derived-state";
import type { DerivedDisplayState } from "@/lib/supabase/types";

interface StatusBadgeProps {
  state: DerivedDisplayState;
  className?: string;
}

export function StatusBadge({ state, className }: StatusBadgeProps) {
  const config = getStatusBadgeConfig(state);

  return (
    <Badge variant={config.variant} className={className}>
      {config.label}
    </Badge>
  );
}
