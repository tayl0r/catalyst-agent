import type { Conversation, Project } from "@shared/types";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";

interface SidebarProps {
  conversations: Conversation[];
  currentId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  projects: Project[];
  filterProjectId: string | null;
  onFilterProject: (id: string | null) => void;
}

// Hardcoded for consistent formatting across locales
const LOCALE = "en-US";

function formatTimestamp(dateStr: string): string {
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return "";

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86400000);
  const dateDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());

  const time = date.toLocaleTimeString(LOCALE, {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });

  if (dateDay.getTime() === today.getTime()) {
    return `Today ${time}`;
  }
  if (dateDay.getTime() === yesterday.getTime()) {
    return `Yesterday ${time}`;
  }
  const month = date.toLocaleString(LOCALE, { month: "short" });
  return `${month} ${date.getDate()} ${time}`;
}

interface ConversationItemProps {
  conv: Conversation;
  isActive: boolean;
  project: Project | undefined;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
}

function ConversationItem({ conv, isActive, project, onSelect, onDelete }: ConversationItemProps) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onSelect(conv.id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect(conv.id);
        }
      }}
      className={`group flex cursor-pointer items-start justify-between gap-2 px-3 py-2.5 transition-colors ${
        isActive
          ? "bg-gray-700/60 text-gray-100"
          : "text-gray-400 hover:bg-gray-800/60 hover:text-gray-200"
      }`}
    >
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm">{conv.name}</p>
        <div className="flex items-center gap-1.5 mt-0.5">
          {project && (
            <>
              <span
                className="inline-block h-2 w-2 rounded-full shrink-0"
                style={{ backgroundColor: project.color }}
              />
              <span className="text-xs text-gray-500 truncate">{project.name}</span>
              <span className="text-xs text-gray-600">&middot;</span>
            </>
          )}
          <span className="text-xs text-gray-500">{formatTimestamp(conv.updated_at)}</span>
        </div>
      </div>
      <button
        type="button"
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
          aria-hidden="true"
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
}

export default function Sidebar({
  conversations,
  currentId,
  onSelect,
  onNew,
  onDelete,
  projects,
  filterProjectId,
  onFilterProject,
}: SidebarProps) {
  const { active, archived } = useMemo(() => {
    const filtered = [...conversations]
      .filter((c) => !filterProjectId || c.projectId === filterProjectId)
      .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
    return {
      active: filtered.filter((c) => !c.archived),
      archived: filtered.filter((c) => c.archived),
    };
  }, [conversations, filterProjectId]);

  const [showArchived, setShowArchived] = useState(false);
  const projectMap = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);
  const noProjects = projects.length === 0;

  return (
    <div className="flex w-64 flex-col border-r border-gray-800 bg-gray-900">
      <div className="px-3 pt-3 pb-1">
        <h1 className="text-sm font-bold text-gray-100">Catalyst Agent</h1>
        <p
          className="text-xs text-gray-500"
          title={`Version ${__APP_VERSION__} (${__GIT_COMMIT__})`}
        >
          v{__APP_VERSION__} · {__GIT_COMMIT__}
        </p>
      </div>
      <div className="p-3 space-y-2">
        {/* Project filter */}
        <div>
          <label htmlFor="project-filter" className="block text-xs text-gray-500 mb-1">
            Filter by project
          </label>
          <select
            id="project-filter"
            value={filterProjectId ?? ""}
            onChange={(e) => onFilterProject(e.target.value || null)}
            disabled={noProjects}
            className="w-full rounded border border-gray-700 bg-gray-800 px-2 py-1.5 text-sm text-gray-200 focus:border-blue-500 focus:outline-none disabled:opacity-50"
          >
            <option value="">All projects</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>

        <button
          type="button"
          onClick={onNew}
          disabled={noProjects}
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-gray-700 px-3 py-2 text-sm text-gray-300 hover:bg-gray-800 hover:text-gray-100 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <span className="text-lg leading-none">+</span>
          New conversation
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {active.map((conv) => (
          <ConversationItem
            key={conv.id}
            conv={conv}
            isActive={conv.id === currentId}
            project={projectMap.get(conv.projectId)}
            onSelect={onSelect}
            onDelete={onDelete}
          />
        ))}

        {archived.length > 0 && (
          <>
            <button
              type="button"
              onClick={() => setShowArchived((v) => !v)}
              className="flex w-full items-center gap-2 px-3 py-2 text-xs text-gray-500 hover:text-gray-400 transition-colors"
            >
              <svg
                aria-hidden="true"
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 20 20"
                fill="currentColor"
                className={`h-3 w-3 transition-transform ${showArchived ? "rotate-90" : ""}`}
              >
                <path
                  fillRule="evenodd"
                  d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z"
                  clipRule="evenodd"
                />
              </svg>
              Archived ({archived.length})
            </button>
            {showArchived &&
              archived.map((conv) => (
                <ConversationItem
                  key={conv.id}
                  conv={conv}
                  isActive={conv.id === currentId}
                  project={projectMap.get(conv.projectId)}
                  onSelect={onSelect}
                  onDelete={onDelete}
                />
              ))}
          </>
        )}
      </div>

      {/* Manage Projects link */}
      <div className="border-t border-gray-800 p-3">
        <Link
          to="/projects"
          className="block text-center text-xs text-gray-500 hover:text-gray-300 transition-colors"
        >
          Manage Projects
        </Link>
      </div>
    </div>
  );
}
