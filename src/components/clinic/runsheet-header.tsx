"use client";

import { Button } from "@/components/ui/button";
import { LiveClock } from "@/components/ui/live-clock";
import { formatRunsheetDate } from "@/lib/runsheet/format";

interface RunsheetHeaderProps {
  timezone: string;
  showAddButton?: boolean;
  onAddSession?: () => void;
}

export function RunsheetHeader({
  timezone,
  showAddButton = true,
  onAddSession,
}: RunsheetHeaderProps) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <h1 className="text-2xl font-semibold text-gray-800">Run sheet</h1>
        <div className="flex items-center gap-2 mt-1">
          <span className="text-sm text-gray-500">
            {formatRunsheetDate(new Date())}
          </span>
          <span className="text-gray-200">|</span>
          <LiveClock timezone={timezone} />
        </div>
      </div>

      {showAddButton && (
        <Button onClick={onAddSession}>
          + Add session
        </Button>
      )}
    </div>
  );
}
