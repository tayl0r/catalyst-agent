import fs from "fs";
import path from "path";
import os from "os";
import crypto from "crypto";
import { fileURLToPath } from "url";
import { PROJECT_COLORS } from "@shared/types.js";
import type { Project } from "@shared/types.js";
import { atomicWrite, readJson, isValidId } from "./utils.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "data");
const PROJECTS_FILE = path.join(DATA_DIR, "projects.json");

function ensureDir(): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

export function expandTilde(p: string): string {
  if (p.startsWith("~/") || p === "~") {
    return path.join(os.homedir(), p.slice(1));
  }
  return p;
}

ensureDir();

export function loadProjects(): Project[] {
  return readJson<Project[]>(PROJECTS_FILE, []);
}

export function getProject(id: string): Project | undefined {
  if (!isValidId(id)) return undefined;
  return loadProjects().find((p) => p.id === id);
}

export function createProject(name: string, projectPath: string, description?: string, color?: string): Project {
  const projects = loadProjects();
  const project: Project = {
    id: crypto.randomUUID(),
    name,
    path: projectPath,
    description,
    color: color || PROJECT_COLORS[projects.length % PROJECT_COLORS.length],
  };
  projects.push(project);
  atomicWrite(PROJECTS_FILE, JSON.stringify(projects, null, 2));
  return project;
}

export function updateProject(id: string, updates: Partial<Pick<Project, "name" | "path" | "description" | "color">>): Project | undefined {
  if (!isValidId(id)) return undefined;
  const projects = loadProjects();
  const project = projects.find((p) => p.id === id);
  if (!project) return undefined;
  if (updates.name !== undefined) project.name = updates.name;
  if (updates.path !== undefined) project.path = updates.path;
  if (updates.description !== undefined) project.description = updates.description;
  if (updates.color !== undefined) project.color = updates.color;
  atomicWrite(PROJECTS_FILE, JSON.stringify(projects, null, 2));
  return project;
}

export function deleteProject(id: string): boolean {
  if (!isValidId(id)) return false;
  const projects = loadProjects();
  const filtered = projects.filter((p) => p.id !== id);
  if (filtered.length === projects.length) return false;
  atomicWrite(PROJECTS_FILE, JSON.stringify(filtered, null, 2));
  return true;
}

export function populateFromDirectory(rootDir: string): void {
  const existing = loadProjects();
  if (existing.length > 0) return; // only on first run

  const expanded = expandTilde(rootDir);
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(expanded, { withFileTypes: true });
  } catch (err) {
    console.warn(`Could not read ROOT_PROJECT_DIR "${expanded}":`, (err as Error).message);
    return;
  }

  const dirs = entries
    .filter((e) => e.isDirectory() && !e.name.startsWith("."))
    .sort((a, b) => a.name.localeCompare(b.name));

  const projects: Project[] = dirs.map((d, i) => ({
    id: crypto.randomUUID(),
    name: d.name,
    path: path.join(expanded, d.name),
    color: PROJECT_COLORS[i % PROJECT_COLORS.length],
  }));

  if (projects.length > 0) {
    atomicWrite(PROJECTS_FILE, JSON.stringify(projects, null, 2));
    console.log(`Pre-populated ${projects.length} projects from ${rootDir}`);
  }
}

export function getProjectPath(id: string): string | undefined {
  const project = getProject(id);
  if (!project) return undefined;
  return expandTilde(project.path);
}
