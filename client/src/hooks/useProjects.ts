import { useState, useEffect, useCallback } from "react";
import type { Project } from "@shared/types";

interface UseProjectsReturn {
  projects: Project[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
  createProject: (data: { name: string; description?: string; color?: string }) => Promise<Project | null>;
  updateProject: (id: string, data: Partial<Pick<Project, "name" | "path" | "description" | "color">>) => Promise<Project | null>;
  deleteProject: (id: string) => Promise<boolean>;
}

export default function useProjects(): UseProjectsReturn {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    setLoading(true);
    setError(null);
    fetch("/api/projects")
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data: Project[]) => {
        setProjects(data);
        setLoading(false);
      })
      .catch((err: Error) => {
        setError(err.message);
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const createProjectFn = useCallback(
    async (data: { name: string; description?: string; color?: string }): Promise<Project | null> => {
      try {
        const res = await fetch("/api/projects", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        });
        if (!res.ok) {
          const body = await res.json();
          setError(body.error || `HTTP ${res.status}`);
          return null;
        }
        const project: Project = await res.json();
        setProjects((prev) => [...prev, project]);
        setError(null);
        return project;
      } catch (err) {
        setError((err as Error).message);
        return null;
      }
    },
    []
  );

  const updateProjectFn = useCallback(
    async (id: string, data: Partial<Pick<Project, "name" | "path" | "description" | "color">>): Promise<Project | null> => {
      try {
        const res = await fetch(`/api/projects/${id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        });
        if (!res.ok) {
          const body = await res.json();
          setError(body.error || `HTTP ${res.status}`);
          return null;
        }
        const updated: Project = await res.json();
        setProjects((prev) => prev.map((p) => (p.id === id ? updated : p)));
        setError(null);
        return updated;
      } catch (err) {
        setError((err as Error).message);
        return null;
      }
    },
    []
  );

  const deleteProjectFn = useCallback(
    async (id: string): Promise<boolean> => {
      try {
        const res = await fetch(`/api/projects/${id}`, { method: "DELETE" });
        if (!res.ok) {
          const body = await res.json();
          setError(body.error || `HTTP ${res.status}`);
          return false;
        }
        setProjects((prev) => prev.filter((p) => p.id !== id));
        setError(null);
        return true;
      } catch (err) {
        setError((err as Error).message);
        return false;
      }
    },
    []
  );

  return {
    projects,
    loading,
    error,
    refresh,
    createProject: createProjectFn,
    updateProject: updateProjectFn,
    deleteProject: deleteProjectFn,
  };
}
