interface ResultSummaryProps {
  durationMs?: number;
  isError?: boolean;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export default function ResultSummary({ durationMs, isError }: ResultSummaryProps) {
  if (durationMs == null) return null;

  const color = isError ? "text-red-400" : "text-gray-500";

  return (
    <div className={`flex justify-center text-xs ${color} my-1`}>
      <span>{formatDuration(durationMs)}</span>
    </div>
  );
}
