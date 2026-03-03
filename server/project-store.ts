import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Project } from "@shared/types.js";
import { PROJECT_COLORS } from "@shared/types.js";
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

// In-memory project cache (mirrors the conversationIndex pattern in store.ts)
let projectCache: Project[] | null = null;

export function loadProjects(): Project[] {
  if (projectCache !== null) return projectCache;
  projectCache = readJson<Project[]>(PROJECTS_FILE, []);
  return projectCache;
}

function writeProjects(projects: Project[]): void {
  atomicWrite(PROJECTS_FILE, JSON.stringify(projects, null, 2));
  projectCache = projects;
}

export function getProject(id: string): Project | undefined {
  if (!isValidId(id)) return undefined;
  return loadProjects().find((p) => p.id === id);
}

function writeClaudeMd(projectPath: string): void {
  const section = [
    "# Catalyst Agent",
    "",
    "This project is managed by Catalyst Agent. Your dev server ports are defined in",
    "PORTS.LOCAL (auto-generated per worktree). Start the server with start.local.sh.",
    "If you need to change how the server is started, edit both start.sh (using __PORT_N__",
    "template vars) and start.local.sh (using real port numbers).",
    "If you need additional ports while making changes, add another entry to PORTS",
    "and PORTS.LOCAL.",
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
    let freshRepo = false;
    try {
      execFileSync("git", ["rev-parse", "--is-inside-work-tree"], {
        cwd: projectPath,
        timeout: 5000,
        stdio: "pipe",
      });
      hasGit = true;
    } catch {
      try {
        execFileSync("git", ["init", "-b", "main"], {
          cwd: projectPath,
          timeout: 5000,
          stdio: "pipe",
        });
        // Empty commit so a branch exists (required for worktrees)
        execFileSync("git", ["commit", "--allow-empty", "-m", "Initial commit"], {
          cwd: projectPath,
          timeout: 5000,
          stdio: "pipe",
        });
        hasGit = true;
        freshRepo = true;
      } catch (err) {
        console.warn(`Could not git init "${projectPath}":`, (err as Error).message);
      }
    }

    // 2. .gitignore (only if git repo exists, create or append)
    if (hasGit) {
      const gitignorePath = path.join(projectPath, ".gitignore");
      const catalystEntries = ["start.local.sh", "PORTS.LOCAL", ".claude/"];
      if (!fs.existsSync(gitignorePath)) {
        const defaults = "node_modules/\n.env\n.env.local\n.DS_Store\n*.log\n";
        atomicWrite(gitignorePath, `${defaults}${catalystEntries.join("\n")}\n`);
      } else {
        const existing = fs.readFileSync(gitignorePath, "utf8");
        const missing = catalystEntries.filter((e) => !existing.includes(e));
        if (missing.length > 0) {
          atomicWrite(gitignorePath, `${existing.trimEnd()}\n${missing.join("\n")}\n`);
        }
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

    // 5. start.sh template (skip if exists)
    const startShPath = path.join(projectPath, "start.sh");
    if (!fs.existsSync(startShPath)) {
      atomicWrite(
        startShPath,
        [
          "#!/bin/bash",
          "# Dev server start script for this project.",
          "# Use __PORT_1__, __PORT_2__, etc. as template variables — they will be replaced",
          "# with real port numbers in start.local.sh (auto-generated per worktree).",
          "# Update this file to configure how your dev server starts.",
          "",
          'echo "No dev server configured. Edit start.sh to add your start command."',
          'echo "Available ports: __PORT_1__"',
          "",
        ].join("\n"),
      );
      fs.chmodSync(startShPath, 0o755);
    }

    // 6. PORTS template (skip if exists)
    const portsMdPath = path.join(projectPath, "PORTS");
    if (!fs.existsSync(portsMdPath)) {
      atomicWrite(
        portsMdPath,
        [
          "# Port Assignments",
          "",
          "This file defines the port template variables for this project.",
          "Each __PORT_N__ variable will be replaced with a real port number in PORTS.LOCAL.",
          "Update this file to add more ports as your project needs them.",
          "",
          "__PORT_1__: Main dev server",
          "",
        ].join("\n"),
      );
    }

    // 7. Commit scaffolded files (only for freshly created repos)
    if (freshRepo) {
      try {
        execFileSync("git", ["add", "-A"], {
          cwd: projectPath,
          timeout: 5000,
          stdio: "pipe",
        });
        execFileSync("git", ["commit", "-m", "Add scaffolded files"], {
          cwd: projectPath,
          timeout: 5000,
          stdio: "pipe",
        });
      } catch (err) {
        console.warn(
          `Could not create initial commit in "${projectPath}":`,
          (err as Error).message,
        );
      }
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
    description,
    color: color || PROJECT_COLORS[projects.length % PROJECT_COLORS.length],
  };
  projects.push(project);
  projects.sort((a, b) => a.name.localeCompare(b.name));
  writeProjects(projects);
  writeClaudeMd(projectPath);
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
  writeProjects(projects);
  return project;
}

export function deleteProject(id: string): boolean {
  if (!isValidId(id)) return false;
  const projects = loadProjects();
  const filtered = projects.filter((p) => p.id !== id);
  if (filtered.length === projects.length) return false;
  writeProjects(filtered);
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
    color: PROJECT_COLORS[i % PROJECT_COLORS.length],
  }));

  if (projects.length > 0) {
    writeProjects(projects);
    console.log(`Pre-populated ${projects.length} projects from ${rootDir}`);
  }
}

export function getProjectPath(id: string): string | undefined {
  const project = getProject(id);
  if (!project) return undefined;
  return expandTilde(project.path);
}
