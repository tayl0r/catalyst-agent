import { PORT_INCREMENT, PROJECT_COLORS } from "@shared/types";
import { useState } from "react";
import { Link } from "react-router-dom";
import useProjects from "../hooks/useProjects";

interface ProjectForm {
  name: string;
  path: string;
  description: string;
  color: string;
}

const emptyForm: ProjectForm = { name: "", path: "", description: "", color: PROJECT_COLORS[0] };

export default function ProjectsPage() {
  const { projects, loading, error, createProject, updateProject, deleteProject } = useProjects();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<ProjectForm>(emptyForm);
  const [showAdd, setShowAdd] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const startEdit = (id: string) => {
    const p = projects.find((proj) => proj.id === id);
    if (!p) return;
    setEditingId(id);
    setShowAdd(false);
    setForm({ name: p.name, path: p.path, description: p.description || "", color: p.color });
    setFormError(null);
  };

  const startAdd = () => {
    setEditingId(null);
    setShowAdd(true);
    setForm(emptyForm);
    setFormError(null);
  };

  const cancel = () => {
    setEditingId(null);
    setShowAdd(false);
    setForm(emptyForm);
    setFormError(null);
  };

  const handleSave = async () => {
    if (!form.name.trim()) {
      setFormError("Name is required");
      return;
    }
    if (editingId && !form.path.trim()) {
      setFormError("Path is required");
      return;
    }
    setFormError(null);

    if (editingId) {
      const result = await updateProject(editingId, {
        name: form.name,
        path: form.path,
        description: form.description || undefined,
        color: form.color,
      });
      if (result) cancel();
      else setFormError("Failed to update project");
    } else {
      const result = await createProject({
        name: form.name,
        description: form.description || undefined,
        color: form.color,
      });
      if (result) cancel();
      else setFormError("Failed to create project");
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm("Delete this project?")) return;
    await deleteProject(id);
  };

  const formSection = (
    <div className="rounded-lg border border-gray-800 bg-gray-900 p-4 space-y-3">
      <h3 className="text-sm font-medium text-gray-200">
        {editingId ? "Edit Project" : "Add Project"}
      </h3>
      {formError && <p className="text-sm text-red-400">{formError}</p>}
      <div className="space-y-2">
        <input
          type="text"
          placeholder="Project name"
          value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          className="w-full rounded border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:border-blue-500 focus:outline-none"
        />
        {editingId && (
          <input
            type="text"
            placeholder="Absolute path (e.g. /Users/you/dev/project)"
            value={form.path}
            onChange={(e) => setForm((f) => ({ ...f, path: e.target.value }))}
            className="w-full rounded border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:border-blue-500 focus:outline-none"
          />
        )}
        <input
          type="text"
          placeholder="Description (optional)"
          value={form.description}
          onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
          className="w-full rounded border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:border-blue-500 focus:outline-none"
        />
        <div>
          <span className="block text-xs text-gray-400 mb-1">Color</span>
          <div className="flex gap-2">
            {PROJECT_COLORS.map((c) => (
              <button
                type="button"
                key={c}
                onClick={() => setForm((f) => ({ ...f, color: c }))}
                className={`h-6 w-6 rounded-full border-2 transition-transform ${
                  form.color === c ? "border-white scale-110" : "border-transparent"
                }`}
                style={{ backgroundColor: c }}
                title={c}
              />
            ))}
          </div>
        </div>
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={handleSave}
          className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-500 transition-colors"
        >
          {editingId ? "Save" : "Add"}
        </button>
        <button
          type="button"
          onClick={cancel}
          className="rounded border border-gray-700 px-3 py-1.5 text-sm text-gray-400 hover:text-gray-200 transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-950 font-mono text-gray-100">
      <div className="mx-auto max-w-3xl px-4 py-8">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-xl font-semibold">Projects</h1>
          <Link to="/" className="text-sm text-gray-400 hover:text-gray-200 transition-colors">
            Back to Chat
          </Link>
        </div>

        {error && (
          <div className="mb-4 rounded border border-red-800 bg-red-900/30 px-3 py-2 text-sm text-red-300">
            {error}
          </div>
        )}

        {loading ? (
          <p className="text-gray-500 text-sm">Loading projects...</p>
        ) : (
          <div className="space-y-4">
            {/* Project list */}
            {projects.map((project) => (
              <div
                key={project.id}
                className="flex items-center gap-3 rounded-lg border border-gray-800 bg-gray-900 px-4 py-3"
              >
                <span
                  className="h-3 w-3 rounded-full shrink-0"
                  style={{ backgroundColor: project.color }}
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{project.name}</p>
                  <p className="text-xs text-gray-500 truncate">{project.path}</p>
                  <p className="text-xs text-gray-500">
                    Ports {project.port}&ndash;{project.port + PORT_INCREMENT - 1}
                  </p>
                  {project.description && (
                    <p className="text-xs text-gray-400 mt-0.5 truncate">{project.description}</p>
                  )}
                </div>
                <div className="flex gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => startEdit(project.id)}
                    className="rounded px-2 py-1 text-xs text-gray-400 hover:bg-gray-800 hover:text-gray-200 transition-colors"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(project.id)}
                    className="rounded px-2 py-1 text-xs text-gray-400 hover:bg-gray-800 hover:text-red-400 transition-colors"
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}

            {projects.length === 0 && (
              <p className="text-gray-500 text-sm">No projects yet. Add one to get started.</p>
            )}

            {/* Form */}
            {(showAdd || editingId) && formSection}

            {/* Add button */}
            {!showAdd && !editingId && (
              <button
                type="button"
                onClick={startAdd}
                className="flex items-center gap-2 rounded-lg border border-dashed border-gray-700 px-4 py-3 text-sm text-gray-400 hover:border-gray-500 hover:text-gray-200 transition-colors w-full"
              >
                <span className="text-lg leading-none">+</span>
                Add Project
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
