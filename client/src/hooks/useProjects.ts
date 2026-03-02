import type { Project } from "@shared/types";
import { useCallback, useEffect, useState } from "react";

interface UseProjectsReturn {
  projects: Project[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
  createProject: (data: {
    name: string;
    description?: string;
    color?: string;
  }) => Promise<Project | null>;
  updateProject: (
    id: string,
    data: Partial<Pick<Project, "name" | "path" | "description" | "color">>,
  ) => Promise<Project | null>;
  deleteProject: (id: string) => Promise<boolean>;
}

export default function useProjects(): UseProjectsReturn {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function apiCall<T>(
    url: string,
    options: RequestInit = {},
  ): Promise<{ ok: true; data: T } | { ok: false }> {
    try {
      const res = await fetch(url, options);
      if (!res.ok) {
        const body = await res.json();
        setError(body.error || `HTTP ${res.status}`);
        return { ok: false };
      }
      const data = res.status === 204 ? (undefined as T) : ((await res.json()) as T);
      setError(null);
      return { ok: true, data };
    } catch (err) {
      setError((err as Error).message);
      return { ok: false };
    }
  }

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

  const createProject = useCallback(
    async (data: {
      name: string;
      description?: string;
      color?: string;
    }): Promise<Project | null> => {
      const result = await apiCall<Project>("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!result.ok) return null;
      setProjects((prev) => [...prev, result.data]);
      return result.data;
    },
    [],
  );

  const updateProject = useCallback(
    async (
      id: string,
      data: Partial<Pick<Project, "name" | "path" | "description" | "color">>,
    ): Promise<Project | null> => {
      const result = await apiCall<Project>(`/api/projects/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!result.ok) return null;
      setProjects((prev) => prev.map((p) => (p.id === id ? result.data : p)));
      return result.data;
    },
    [],
  );

  const deleteProject = useCallback(async (id: string): Promise<boolean> => {
    const result = await apiCall<undefined>(`/api/projects/${id}`, { method: "DELETE" });
    if (!result.ok) return false;
    setProjects((prev) => prev.filter((p) => p.id !== id));
    return true;
  }, []);

  return {
    projects,
    loading,
    error,
    refresh,
    createProject,
    updateProject,
    deleteProject,
  };
}
