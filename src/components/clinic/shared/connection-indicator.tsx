"use client";

type ConnectionStatus = "connected" | "connecting" | "disconnected";

interface ConnectionIndicatorProps {
  status: ConnectionStatus;
}

const statusConfig: Record<
  ConnectionStatus,
  { color: string; label: string }
> = {
  connected: { color: "bg-green-500", label: "Live" },
  connecting: { color: "bg-amber-500", label: "Connecting" },
  disconnected: { color: "bg-red-500", label: "Reconnecting" },
};

export function ConnectionIndicator({ status }: ConnectionIndicatorProps) {
  const config = statusConfig[status];

  return (
    <div className="flex items-center gap-1.5" title={config.label}>
      <span
        className={`h-2 w-2 rounded-full ${config.color} ${
          status === "connecting" ? "animate-pulse" : ""
        }`}
      />
      {status !== "connected" && (
        <span className="text-xs text-gray-500">{config.label}</span>
      )}
    </div>
  );
}
