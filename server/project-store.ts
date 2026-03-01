import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Project } from "@shared/types.js";
import { PORT_INCREMENT, PROJECT_COLORS } from "@shared/types.js";
import { atomicWrite, isValidId, readJson } from "./utils.js";

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

function getNextPort(projects: Project[]): number {
  const ports = projects.map((p) => p.port).filter((p): p is number => p != null);
  if (ports.length === 0) return 3000;
  return Math.max(...ports) + PORT_INCREMENT;
}

export function loadProjects(): Project[] {
  const projects = readJson<Project[]>(PROJECTS_FILE, []);
  // One-time backfill: assign ports to projects that lack them
  if (projects.length > 0 && projects.some((p) => p.port == null)) {
    for (let i = 0; i < projects.length; i++) {
      if (projects[i].port == null) {
        projects[i].port = 3000 + i * PORT_INCREMENT;
      }
    }
    atomicWrite(PROJECTS_FILE, JSON.stringify(projects, null, 2));
  }
  return projects;
}

export function getProject(id: string): Project | undefined {
  if (!isValidId(id)) return undefined;
  return loadProjects().find((p) => p.id === id);
}

function writeClaudeMd(projectPath: string, startPort: number): void {
  const endPort = startPort + PORT_INCREMENT - 1;
  const section = [
    "# Catalyst Agent",
    "",
    `This project is managed by Catalyst Agent (a project configuration management app). It has assigned you ports ${startPort}-${endPort}. When you create any launch files or server configs, DO NOT use any ports outside of that range.`,
  ].join("\n");

  try {
    const claudeMdPath = path.join(projectPath, "CLAUDE.md");
    if (fs.existsSync(claudeMdPath)) {
      const existing = fs.readFileSync(claudeMdPath, "utf8");
      if (!existing.includes("managed by Catalyst Agent")) {
        atomicWrite(claudeMdPath, `${existing}\n\n${section}\n`);
      }
    } else {
      atomicWrite(claudeMdPath, `${section}\n`);
    }
  } catch (err) {
    console.warn(`Could not write CLAUDE.md in "${projectPath}":`, (err as Error).message);
  }
}

function scaffoldProject(projectPath: string): void {
  if (!fs.existsSync(projectPath)) {
    console.warn(`Scaffold skipped: "${projectPath}" does not exist`);
    return;
  }

  try {
    // 1. git init (skip if already inside a git repo)
    let hasGit = false;
    try {
      execFileSync("git", ["rev-parse", "--is-inside-work-tree"], {
        cwd: projectPath,
        timeout: 5000,
        stdio: "pipe",
      });
      hasGit = true;
    } catch {
      try {
        execFileSync("git", ["init"], {
          cwd: projectPath,
          timeout: 5000,
          stdio: "pipe",
        });
        // Create initial commit so a branch exists (required for worktrees)
        execFileSync("git", ["commit", "--allow-empty", "-m", "Initial commit"], {
          cwd: projectPath,
          timeout: 5000,
          stdio: "pipe",
        });
        hasGit = true;
      } catch (err) {
        console.warn(`Could not git init "${projectPath}":`, (err as Error).message);
      }
    }

    // 2. .gitignore (only if git repo exists, skip if file exists)
    if (hasGit) {
      const gitignorePath = path.join(projectPath, ".gitignore");
      if (!fs.existsSync(gitignorePath)) {
        atomicWrite(gitignorePath, "node_modules/\n.env\n.env.local\n.DS_Store\n*.log\n");
      }
    }

    // 3. .claude/settings.local.json (skip if exists)
    const claudeDir = path.join(projectPath, ".claude");
    const settingsPath = path.join(claudeDir, "settings.local.json");
    if (!fs.existsSync(settingsPath)) {
      fs.mkdirSync(claudeDir, { recursive: true });
      const settings = {
        permissions: {
          allow: [
            "Bash(*)",
            "Edit(*)",
            "Write(*)",
            "Read(*)",
            "Glob(*)",
            "Grep(*)",
            "WebFetch(*)",
            "WebSearch(*)",
            "Task(*)",
          ],
        },
      };
      atomicWrite(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);
    }

    // 4. .claudeignore (skip if exists)
    const claudeignorePath = path.join(projectPath, ".claudeignore");
    if (!fs.existsSync(claudeignorePath)) {
      atomicWrite(claudeignorePath, "node_modules/\n*.log\n");
    }

    console.log(`Scaffolded project at "${projectPath}"`);
  } catch (err) {
    console.warn(`Could not scaffold project at "${projectPath}":`, (err as Error).message);
  }
}

export function createProject(
  name: string,
  projectPath: string,
  description?: string,
  color?: string,
): Project {
  const projects = loadProjects();
  const project: Project = {
    id: crypto.randomUUID(),
    name,
    path: projectPath,
    port: getNextPort(projects),
    description,
    color: color || PROJECT_COLORS[projects.length % PROJECT_COLORS.length],
  };
  projects.push(project);
  projects.sort((a, b) => a.name.localeCompare(b.name));
  atomicWrite(PROJECTS_FILE, JSON.stringify(projects, null, 2));
  writeClaudeMd(projectPath, project.port);
  scaffoldProject(projectPath);
  return project;
}

export function updateProject(
  id: string,
  updates: Partial<Pick<Project, "name" | "path" | "description" | "color">>,
): Project | undefined {
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

// First-run import only — does not write CLAUDE.md to avoid bulk-modifying existing projects
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
    port: 3000 + i * PORT_INCREMENT,
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
