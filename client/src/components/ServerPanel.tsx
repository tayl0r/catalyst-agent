import type { DevServerStatus } from "@shared/types";
import { type ReactNode, useEffect, useRef } from "react";

const URL_RE = /(https?:\/\/[^\s)"'>]+)/;

function linkify(text: string): ReactNode {
  const parts = text.split(URL_RE);
  if (parts.length === 1) return text;
  return parts.map((part, i) =>
    URL_RE.test(part) ? (
      <a
        // biome-ignore lint/suspicious/noArrayIndexKey: stable split output
        key={i}
        href={part}
        target="_blank"
        rel="noreferrer"
        className="text-blue-400 underline hover:text-blue-300"
      >
        {part}
      </a>
    ) : (
      part
    ),
  );
}

interface ServerPanelProps {
  logs: string[];
  status: DevServerStatus;
  ports: Record<string, number> | null;
  onClose: () => void;
}

const STATUS_COLORS: Record<DevServerStatus, string> = {
  running: "bg-green-500",
  starting: "bg-yellow-500",
  stopping: "bg-yellow-500",
  stopped: "bg-gray-500",
};

export default function ServerPanel({ logs, status, ports, onClose }: ServerPanelProps) {
  const logEndRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const isNearBottomRef = useRef(true);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = container;
      isNearBottomRef.current = scrollHeight - scrollTop - clientHeight < 40;
    };
    container.addEventListener("scroll", handleScroll);
    return () => container.removeEventListener("scroll", handleScroll);
  }, []);

  useEffect(() => {
    if (isNearBottomRef.current) {
      logEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [logs]);

  return (
    <div className="flex w-96 shrink-0 flex-col border-l border-gray-800 bg-gray-900">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-800 px-3 py-2">
        <div className="flex items-center gap-2">
          <span className={`h-2 w-2 rounded-full ${STATUS_COLORS[status]}`} />
          <span className="text-sm font-medium text-gray-300">Dev Server</span>
          <span className="text-xs text-gray-500">{status}</span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-gray-500 hover:text-gray-300 transition-colors"
          title="Close panel"
        >
          <svg
            className="h-4 w-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>
      </div>

      {/* Ports bar */}
      {ports && Object.keys(ports).length > 0 && (
        <div className="flex flex-wrap gap-x-3 gap-y-1 border-b border-gray-800 px-3 py-1.5">
          {Object.entries(ports).map(([name, port]) => (
            <span key={name} className="text-xs text-gray-400">
              <span className="text-gray-500">{name}:</span> {port}
            </span>
          ))}
        </div>
      )}

      {/* Log area */}
      <div
        ref={containerRef}
        className="flex-1 overflow-y-auto bg-gray-950 p-3 font-mono text-xs leading-relaxed"
      >
        {logs.length === 0 ? (
          <span className="text-gray-600">No output yet</span>
        ) : (
          logs.map((line, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: log lines are append-only
            <span key={i} className="whitespace-pre-wrap text-gray-400 block">
              {linkify(line)}
            </span>
          ))
        )}
        <div ref={logEndRef} />
      </div>
    </div>
  );
}
