import type { Conversation } from "@shared/types";

interface SidebarProps {
  conversations: Conversation[];
  currentId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
}

function relativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  if (Number.isNaN(then)) return "";
  const diff = now - then;

  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return "just now";

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;

  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

export default function Sidebar({
  conversations,
  currentId,
  onSelect,
  onNew,
  onDelete,
}: SidebarProps) {
  const sorted = [...conversations].sort(
    (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
  );

  return (
    <div className="flex w-64 flex-col border-r border-gray-800 bg-gray-900">
      <div className="p-3">
        <button
          onClick={onNew}
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-gray-700 px-3 py-2 text-sm text-gray-300 hover:bg-gray-800 hover:text-gray-100 transition-colors"
        >
          <span className="text-lg leading-none">+</span>
          New conversation
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {sorted.map((conv) => {
          const isActive = conv.id === currentId;
          return (
            <div
              key={conv.id}
              onClick={() => onSelect(conv.id)}
              className={`group flex cursor-pointer items-start justify-between gap-2 px-3 py-2.5 transition-colors ${
                isActive
                  ? "bg-gray-700/60 text-gray-100"
                  : "text-gray-400 hover:bg-gray-800/60 hover:text-gray-200"
              }`}
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm">{conv.title}</p>
                <p className="text-xs text-gray-500 mt-0.5">
                  {relativeTime(conv.updated_at)}
                </p>
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (window.confirm("Delete this conversation?")) {
                    onDelete(conv.id);
                  }
                }}
                className="mt-0.5 shrink-0 rounded p-0.5 text-gray-600 opacity-0 hover:bg-gray-700 hover:text-gray-300 group-hover:opacity-100 transition-opacity"
                title="Delete conversation"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  className="h-3.5 w-3.5"
                >
                  <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
                </svg>
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
