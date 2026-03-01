import type { Project } from "@shared/types";
import { slugify } from "@shared/types";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

interface NewConversationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (name: string, projectId: string) => void;
  projects: Project[];
  initialProjectId?: string | null;
}

export default function NewConversationModal({
  isOpen,
  onClose,
  onSubmit,
  projects,
  initialProjectId,
}: NewConversationModalProps) {
  const [name, setName] = useState("");
  const [projectQuery, setProjectQuery] = useState("");
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [showDropdown, setShowDropdown] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(0);

  const nameInputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const projectInputRef = useRef<HTMLInputElement>(null);

  const slug = name.trim() ? slugify(name.trim()) : "";
  const canSubmit = name.trim() !== "" && selectedProject !== null;

  const visibleResults = useMemo(() => {
    const q = projectQuery.toLowerCase();
    return projects.filter((p) => p.name.toLowerCase().includes(q));
  }, [projects, projectQuery]);

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setName("");
      setShowDropdown(false);
      setHighlightIndex(0);

      const initial = initialProjectId ? projects.find((p) => p.id === initialProjectId) : null;
      if (initial) {
        setSelectedProject(initial);
        setProjectQuery(initial.name);
        setTimeout(() => {
          nameInputRef.current?.focus();
          setShowDropdown(false);
        }, 50);
      } else {
        setSelectedProject(null);
        setProjectQuery("");
        setTimeout(() => projectInputRef.current?.focus(), 50);
      }
    }
  }, [isOpen, initialProjectId, projects]);

  // Clamp highlight index when results change
  useEffect(() => {
    setHighlightIndex((prev) => Math.min(prev, Math.max(0, visibleResults.length - 1)));
  }, [visibleResults.length]);

  // Close dropdown on outside click
  useEffect(() => {
    if (!showDropdown) return;
    function handleClick(e: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node) &&
        projectInputRef.current &&
        !projectInputRef.current.contains(e.target as Node)
      ) {
        setShowDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showDropdown]);

  const selectProject = useCallback((project: Project) => {
    setSelectedProject(project);
    setProjectQuery(project.name);
    setShowDropdown(false);
    // Focus name input after selecting project
    setTimeout(() => nameInputRef.current?.focus(), 50);
  }, []);

  const handleSubmit = useCallback(() => {
    if (canSubmit && selectedProject) {
      onSubmit(name.trim(), selectedProject.id);
    }
  }, [canSubmit, selectedProject, name, onSubmit]);

  const handleProjectKeyDown = (e: React.KeyboardEvent) => {
    if (!showDropdown) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        setShowDropdown(true);
        e.preventDefault();
      }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightIndex((prev) => Math.min(prev + 1, visibleResults.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightIndex((prev) => Math.max(prev - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (visibleResults[highlightIndex]) {
        selectProject(visibleResults[highlightIndex]);
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      setShowDropdown(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="new-conversation-title"
    >
      <form
        className="bg-gray-900 rounded-xl p-6 max-w-md w-full mx-4 border border-gray-700"
        onSubmit={(e) => {
          e.preventDefault();
          handleSubmit();
        }}
      >
        <h2 id="new-conversation-title" className="text-lg font-semibold text-gray-100 mb-4">
          New Conversation
        </h2>

        {/* Project autocomplete */}
        <div className="mb-4">
          <label htmlFor="project-search" className="block text-sm text-gray-400 mb-1.5">
            Project
          </label>
          <div className="relative">
            <input
              id="project-search"
              ref={projectInputRef}
              type="text"
              value={projectQuery}
              onChange={(e) => {
                setProjectQuery(e.target.value);
                setSelectedProject(null);
                setShowDropdown(true);
                setHighlightIndex(0);
              }}
              onFocus={() => setShowDropdown(true)}
              onKeyDown={handleProjectKeyDown}
              placeholder="Search projects..."
              className="w-full rounded border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-200 placeholder-gray-500 focus:border-blue-500 focus:outline-none"
            />
            {selectedProject && (
              <span
                className="absolute right-2 top-1/2 -translate-y-1/2 inline-block h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: selectedProject.color }}
              />
            )}
            {showDropdown && visibleResults.length > 0 && (
              <div
                ref={dropdownRef}
                className="absolute z-10 mt-1 w-full max-h-60 overflow-y-auto rounded border border-gray-700 bg-gray-800 py-1"
              >
                {visibleResults.map((project, i) => (
                  <button
                    key={project.id}
                    type="button"
                    className={`flex w-full items-center gap-2 px-3 py-1.5 text-sm text-left transition-colors ${
                      i === highlightIndex
                        ? "bg-gray-700 text-gray-100"
                        : "text-gray-300 hover:bg-gray-700/50"
                    }`}
                    onMouseEnter={() => setHighlightIndex(i)}
                    onClick={() => selectProject(project)}
                  >
                    <span
                      className="inline-block h-2.5 w-2.5 rounded-full shrink-0"
                      style={{ backgroundColor: project.color }}
                    />
                    {project.name}
                  </button>
                ))}
              </div>
            )}
            {showDropdown && visibleResults.length === 0 && projectQuery && (
              <div className="absolute z-10 mt-1 w-full rounded border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-500">
                No projects found
              </div>
            )}
          </div>
        </div>

        {/* Conversation name */}
        <div className="mb-4">
          <label htmlFor="conversation-name" className="block text-sm text-gray-400 mb-1.5">
            Feature <span className="text-gray-600">(creates a branch &amp; worktree)</span>
          </label>
          <input
            id="conversation-name"
            ref={nameInputRef}
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={200}
            placeholder="e.g. add-auth-flow"
            className="w-full rounded border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-200 placeholder-gray-500 focus:border-blue-500 focus:outline-none"
          />
          {slug && (
            <p className="mt-1 text-xs text-gray-500">
              slug: <span className="text-gray-400">{slug}</span>
            </p>
          )}
        </div>

        {/* Buttons */}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded px-4 py-2 text-sm text-gray-400 hover:text-gray-200 transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!canSubmit}
            className="rounded bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-500 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Create
          </button>
        </div>
      </form>
    </div>
  );
}
