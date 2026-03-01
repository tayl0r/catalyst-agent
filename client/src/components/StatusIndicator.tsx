import type { ConnectionStatus } from "@shared/types";

interface StatusIndicatorProps {
  status: ConnectionStatus;
}

export default function StatusIndicator({ status }: StatusIndicatorProps) {
  const color =
    status === "connected"
      ? "bg-green-500"
      : status === "connecting"
        ? "bg-yellow-500"
        : "bg-red-500";

  const label =
    status === "connected"
      ? "Connected"
      : status === "connecting"
        ? "Connecting..."
        : "Disconnected";

  return (
    <div className="flex items-center gap-2 text-sm text-gray-400">
      <div className={`h-2 w-2 rounded-full ${color}`} />
      <span>{label}</span>
    </div>
  );
}
