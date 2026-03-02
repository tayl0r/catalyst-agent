import { type ChildProcess, execFile, spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type { DevServerStatus, ResultData, ServerMessage, UIMessage } from "@shared/types.js";
import { isClientMessage } from "@shared/types.js";
import { slugify } from "@shared/utils.js";
import dotenv from "dotenv";
import express from "express";
import { WebSocket, WebSocketServer } from "ws";
import { allocatePorts } from "./port-allocator.js";
import {
  createProject,
  deleteProject,
  expandTilde,
  getProject,
  getProjectPath,
  loadProjects,
  populateFromDirectory,
  updateProject,
} from "./project-store.js";
import {
  appendMessage,
  archiveConversation,
  createConversation,
  deleteConversation as deleteConv,
  getConversation,
  getProjectSlugs,
  loadConversations,
  loadMessages,
  setDevServerStatus,
  setWorktreeCwd,
  touchConversation,
} from "./store.js";
import { isValidId, stripNullValues } from "./utils.js";

const execFileAsync = promisify(execFile);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({
  path: [path.resolve(__dirname, "../.env.local"), path.resolve(__dirname, "../.env")],
});

const PORT = process.env.CATAGENT_SERVER_PORT || 2999;
const MAX_CONNECTIONS = 10;

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

// --- Dev server process map (survives WebSocket reconnects) ---
const serverProcesses = new Map<
  string,
  { process: ChildProcess; killTimeout: ReturnType<typeof setTimeout> | null }
>();

// --- CLI process map (survives WebSocket reconnects) ---
const cliProcesses = new Map<
  string,
  {
    process: ChildProcess;
    killTimeout: ReturnType<typeof setTimeout> | null;
    streamingText: string;
    rawEvents: Record<string, unknown>[];
  }
>();

// Track which WS clients are viewing which conversation
const conversationClients = new Map<string, Set<WebSocket>>();

function trackClient(ws: WebSocket, conversationId: string, previousId: string | null): void {
  if (previousId) {
    conversationClients.get(previousId)?.delete(ws);
  }
  let clients = conversationClients.get(conversationId);
  if (!clients) {
    clients = new Set();
    conversationClients.set(conversationId, clients);
  }
  clients.add(ws);
}

function untrackClient(ws: WebSocket, conversationId: string | null): void {
  if (conversationId) {
    const clients = conversationClients.get(conversationId);
    if (clients) {
      clients.delete(ws);
      if (clients.size === 0) conversationClients.delete(conversationId);
    }
  }
}

function sendToConversation(conversationId: string, obj: ServerMessage): void {
  const clients = conversationClients.get(conversationId);
  if (!clients) return;
  const data = JSON.stringify(obj);
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  }
}

function broadcastServerStatus(
  conversationId: string,
  status: DevServerStatus,
  ports?: Record<string, number>,
): void {
  setDevServerStatus(conversationId, status);
  sendToConversation(conversationId, {
    type: "server_status",
    conversationId,
    status,
    ...(ports && { ports }),
  });
}

function getServerStatus(conversationId: string): DevServerStatus {
  const conv = getConversation(conversationId);
  return conv?.devServerStatus ?? "stopped";
}

// Send SIGTERM, then SIGKILL after timeout. `group` kills the process group (for detached processes).
function killWithTimeout(
  proc: ChildProcess,
  opts: { group?: boolean; timeoutMs?: number } = {},
): ReturnType<typeof setTimeout> {
  const { group = false, timeoutMs = 3000 } = opts;
  const pid = proc.pid;
  const send = (sig: NodeJS.Signals) => {
    try {
      if (group && pid) process.kill(-pid, sig);
      else proc.kill(sig);
    } catch {
      // ESRCH — process already gone
    }
  };
  send("SIGTERM");
  return setTimeout(() => send("SIGKILL"), timeoutMs);
}

function killServerProcess(conversationId: string): void {
  const entry = serverProcesses.get(conversationId);
  if (!entry) return;
  const { process: proc, killTimeout } = entry;
  if (killTimeout) clearTimeout(killTimeout);

  broadcastServerStatus(conversationId, "stopping");

  if (proc.pid) {
    const timeout = killWithTimeout(proc, { group: true });
    serverProcesses.set(conversationId, { process: proc, killTimeout: timeout });
    // Fallback cleanup if close event never fires
    setTimeout(() => {
      if (serverProcesses.has(conversationId)) {
        serverProcesses.delete(conversationId);
        broadcastServerStatus(conversationId, "stopped");
      }
    }, 5000);
  } else {
    serverProcesses.delete(conversationId);
    broadcastServerStatus(conversationId, "stopped");
  }
}

function killCLIProcess(conversationId: string): void {
  const entry = cliProcesses.get(conversationId);
  if (!entry) return;
  if (entry.killTimeout) clearTimeout(entry.killTimeout);
  cliProcesses.delete(conversationId);
  killWithTimeout(entry.process);
}

async function removeWorktree(
  worktreeCwd: string,
  projectRoot: string,
  label: string,
): Promise<void> {
  try {
    await execFileAsync("git", ["worktree", "remove", worktreeCwd, "--force"], {
      cwd: projectRoot,
      timeout: 15000,
    });
  } catch (err) {
    console.warn(`${label}: worktree remove failed: ${(err as Error).message}`);
  }
}

// --- Startup migration ---
populateFromDirectory(process.env.ROOT_PROJECT_DIR || "~/dev");

// Delete conversations without projectId
const allConvs = loadConversations();
const orphaned = allConvs.filter((c) => !c.projectId);
if (orphaned.length > 0) {
  for (const c of orphaned) {
    deleteConv(c.id);
  }
  console.log(`Deleted ${orphaned.length} conversation(s) without projectId`);
}

// --- Middleware ---
app.use(express.json());

// --- REST API routes ---

app.get("/api/projects", (_req, res) => {
  res.json(loadProjects());
});

app.post("/api/projects", (req, res) => {
  const { name, description, color } = req.body;
  if (typeof name !== "string" || !name.trim()) {
    res.status(400).json({ error: "name is required" });
    return;
  }
  const trimmedName = name.trim();
  if (trimmedName.length > 200) {
    res.status(400).json({ error: "name must be at most 200 characters" });
    return;
  }
  const rootDir = expandTilde(process.env.ROOT_PROJECT_DIR || "~/dev");
  // slugify returns "conversation" as fallback when input has no alphanumeric chars
  let dirName = slugify(trimmedName);
  if (dirName === "conversation") dirName = "project";
  const projectPath = path.join(rootDir, dirName);
  const existingProjects = loadProjects();
  if (existingProjects.some((p) => p.path === projectPath)) {
    res.status(409).json({ error: "A project with that name already exists" });
    return;
  }
  try {
    fs.mkdirSync(projectPath, { recursive: true });
  } catch (err) {
    res.status(500).json({ error: `Could not create directory: ${(err as Error).message}` });
    return;
  }
  const project = createProject(trimmedName, projectPath, description?.trim(), color);
  res.status(201).json(project);
});

app.put("/api/projects/:id", (req, res) => {
  const { id } = req.params;
  const existing = getProject(id);
  if (!existing) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  const { name, path: projectPath, description, color } = req.body;
  if (name !== undefined && (typeof name !== "string" || !name.trim())) {
    res.status(400).json({ error: "name must be a non-empty string" });
    return;
  }
  let resolvedPath: string | undefined;
  if (projectPath !== undefined) {
    if (typeof projectPath !== "string" || !projectPath.trim()) {
      res.status(400).json({ error: "path must be a non-empty string" });
      return;
    }
    resolvedPath = expandTilde(projectPath.trim());
    try {
      const stat = fs.statSync(resolvedPath);
      if (!stat.isDirectory()) {
        res.status(400).json({ error: "path is not a directory" });
        return;
      }
    } catch {
      res.status(400).json({ error: "path does not exist" });
      return;
    }
  }
  const updated = updateProject(id, {
    name: name?.trim(),
    path: resolvedPath,
    description: description?.trim(),
    color,
  });
  res.json(updated);
});

app.delete("/api/projects/:id", (req, res) => {
  const { id } = req.params;
  const existing = getProject(id);
  if (!existing) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  const convs = loadConversations().filter((c) => c.projectId === id);
  if (convs.length > 0) {
    res
      .status(409)
      .json({ error: `Cannot delete: ${convs.length} conversation(s) reference this project` });
    return;
  }
  deleteProject(id);
  res.status(204).end();
});

// --- WebSocket upgrade ---

server.on("upgrade", (req, socket, head) => {
  if (req.url === "/ws") {
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  } else {
    socket.destroy();
  }
});

function broadcast(obj: ServerMessage): void {
  const data = JSON.stringify(obj);
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  }
}

function broadcastConversationList(): void {
  broadcast({ type: "conversation_list", conversations: loadConversations() });
}

wss.on("connection", (ws: WebSocket) => {
  if (wss.clients.size > MAX_CONNECTIONS) {
    ws.close(1013, "Too many connections");
    return;
  }

  console.log(`WS: [connected] clients=${wss.clients.size}`);

  let currentConversationId: string | null = null;
  let pendingProjectId: string | null = null;
  let pendingGitPull: Promise<void> | null = null;

  function send(obj: ServerMessage): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(obj));
    }
  }

  ws.on("message", async (raw: Buffer) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw.toString());
    } catch {
      send({ type: "error", data: "Invalid JSON" });
      return;
    }

    if (!isClientMessage(parsed)) {
      send({ type: "error", data: "Invalid message" });
      return;
    }

    if (parsed.type === "kill") {
      if (currentConversationId) {
        killCLIProcess(currentConversationId);
      }
      return;
    }

    if (parsed.type === "list_conversations") {
      send({ type: "conversation_list", conversations: loadConversations() });
      return;
    }

    if (parsed.type === "delete_conversation") {
      if (!isValidId(parsed.conversationId)) {
        send({ type: "error", data: "Invalid conversation ID" });
        return;
      }
      // Read conversation before deleting so we can clean up the worktree
      const delConv = getConversation(parsed.conversationId);
      killCLIProcess(parsed.conversationId);
      killServerProcess(parsed.conversationId);
      if (delConv?.worktreeCwd && delConv.projectId) {
        const projectRoot = getProjectPath(delConv.projectId);
        if (projectRoot) {
          await removeWorktree(delConv.worktreeCwd, projectRoot, "DELETE");
        }
      }
      deleteConv(parsed.conversationId);
      // If we deleted the current conversation, reset state
      if (currentConversationId === parsed.conversationId) {
        pendingGitPull = null;
        untrackClient(ws, currentConversationId);
        currentConversationId = null;
        pendingProjectId = null;
      }
      // Clean up any other clients still tracked for this conversation
      conversationClients.delete(parsed.conversationId);
      // Broadcast deletion and updated list to all clients
      broadcast({ type: "conversation_deleted", conversationId: parsed.conversationId });
      broadcastConversationList();
      return;
    }

    if (parsed.type === "cleanup_conversation") {
      if (!isValidId(parsed.conversationId)) {
        send({ type: "error", data: "Invalid conversation ID" });
        return;
      }
      const cleanupConv = getConversation(parsed.conversationId);
      if (!cleanupConv) {
        send({ type: "error", data: "Conversation not found" });
        return;
      }
      if (cleanupConv.archived) {
        send({ type: "error", data: "Conversation already archived" });
        return;
      }
      // Stop CLI and dev server
      killCLIProcess(parsed.conversationId);
      killServerProcess(parsed.conversationId);
      // Remove worktree asynchronously (branch is preserved for later reference).
      if (cleanupConv.worktreeCwd && cleanupConv.projectId) {
        const cleanupProjectRoot = getProjectPath(cleanupConv.projectId);
        if (cleanupProjectRoot) {
          await removeWorktree(cleanupConv.worktreeCwd, cleanupProjectRoot, "CLEANUP");
        }
      }
      // Archive the conversation (clears worktreeCwd, ports, devServerStatus)
      archiveConversation(parsed.conversationId);
      const archivedConv = getConversation(parsed.conversationId);
      if (archivedConv) {
        sendToConversation(parsed.conversationId, {
          type: "conversation",
          conversation: archivedConv,
        });
      }
      broadcastConversationList();
      return;
    }

    if (parsed.type === "start_server") {
      if (!currentConversationId) {
        send({ type: "error", data: "No conversation selected" });
        return;
      }
      if (serverProcesses.has(currentConversationId)) {
        send({ type: "error", data: "Server already running" });
        return;
      }
      const sConv = getConversation(currentConversationId);
      if (!sConv?.worktreeCwd) {
        send({ type: "error", data: "No worktree directory available" });
        return;
      }
      if (sConv.archived) {
        send({ type: "error", data: "Conversation is archived" });
        return;
      }
      const projectRoot = sConv.projectId ? getProjectPath(sConv.projectId) : undefined;
      if (projectRoot && !sConv.worktreeCwd.startsWith(`${projectRoot}${path.sep}`)) {
        send({ type: "error", data: "Worktree path is outside project directory" });
        return;
      }
      const scriptPath = path.join(sConv.worktreeCwd, "start.local.sh");
      if (!fs.existsSync(scriptPath)) {
        send({
          type: "error",
          data: "No start.local.sh found in worktree (ports are allocated on init)",
        });
        return;
      }
      broadcastServerStatus(currentConversationId, "starting");
      const sConvId = currentConversationId;
      const serverChild = spawn("bash", [scriptPath], {
        cwd: sConv.worktreeCwd,
        detached: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
      serverProcesses.set(sConvId, { process: serverChild, killTimeout: null });
      console.log(`SERVER: [start] pid=${serverChild.pid} session=${sConvId} script=${scriptPath}`);
      let firstOutput = true;
      const pipeServerOutput = (stream: "stdout" | "stderr") => (chunk: Buffer) => {
        if (firstOutput) {
          firstOutput = false;
          broadcastServerStatus(sConvId, "running");
        }
        sendToConversation(sConvId, {
          type: "server_output",
          conversationId: sConvId,
          data: chunk.toString(),
          stream,
        });
      };
      serverChild.stdout?.on("data", pipeServerOutput("stdout"));
      serverChild.stderr?.on("data", pipeServerOutput("stderr"));
      serverChild.on("close", (code) => {
        console.log(`SERVER: [exit] pid=${serverChild.pid} exitCode=${code} session=${sConvId}`);
        const entry = serverProcesses.get(sConvId);
        if (entry?.killTimeout) clearTimeout(entry.killTimeout);
        serverProcesses.delete(sConvId);
        broadcastServerStatus(sConvId, "stopped");
        sendToConversation(sConvId, {
          type: "server_output",
          conversationId: sConvId,
          data: `\nProcess exited with code ${code}\n`,
          stream: "stdout",
        });
      });
      serverChild.on("error", (err) => {
        console.error(`SERVER: [error] session=${sConvId} error=${err.message}`);
        serverProcesses.delete(sConvId);
        broadcastServerStatus(sConvId, "stopped");
      });
      return;
    }

    if (parsed.type === "stop_server") {
      if (!currentConversationId) {
        send({ type: "error", data: "No conversation selected" });
        return;
      }
      killServerProcess(currentConversationId);
      return;
    }

    if (parsed.type === "create_conversation") {
      const trimmedName = parsed.name.trim();
      if (!trimmedName || trimmedName.length > 200) {
        send({ type: "error", data: "Conversation name must be 1-200 characters" });
        return;
      }
      const project = getProject(parsed.projectId);
      if (!project) {
        send({ type: "error", data: "Project not found" });
        return;
      }
      const id = crypto.randomUUID();
      let slug = slugify(trimmedName);
      if (slug === "conversation") {
        send({ type: "error", data: "Name must contain at least one letter or number" });
        return;
      }
      // Ensure slug uniqueness within project
      const existingSlugs = new Set(getProjectSlugs(parsed.projectId));
      if (existingSlugs.has(slug)) {
        let i = 2;
        while (existingSlugs.has(`${slug}-${i}`)) i++;
        slug = `${slug}-${i}`;
      }
      const conv = createConversation(id, trimmedName, slug, parsed.projectId);
      trackClient(ws, id, currentConversationId);
      currentConversationId = id;
      pendingProjectId = parsed.projectId;
      send({ type: "conversation", conversation: conv });
      send({ type: "messages", messages: [] });
      broadcastConversationList();

      // Background git pull so worktrees branch from latest remote state
      const pullProjectPath = getProjectPath(parsed.projectId);
      if (pullProjectPath) {
        const pullConvId = id;
        send({ type: "sync_status", status: "syncing" });
        pendingGitPull = execFileAsync("git", ["pull", "--ff-only"], {
          cwd: pullProjectPath,
          timeout: 30_000,
        })
          .then(() => {
            if (currentConversationId === pullConvId) {
              send({ type: "sync_status", status: "done" });
            }
          })
          .catch((err: unknown) => {
            const stderr =
              err instanceof Error
                ? (err as Error & { stderr?: string }).stderr || err.message
                : String(err);
            console.warn(`GIT PULL: [error] session=${pullConvId} error=${stderr}`);
            if (currentConversationId === pullConvId) {
              send({ type: "sync_status", status: "error", error: stderr });
            }
          });
      }
      return;
    }

    if (parsed.type === "start") {
      pendingGitPull = null;
      if (!isValidId(parsed.conversationId)) {
        send({ type: "error", data: "Invalid conversation ID" });
        return;
      }
      const conv = getConversation(parsed.conversationId);
      if (!conv) {
        send({ type: "error", data: "Conversation not found" });
        return;
      }
      trackClient(ws, parsed.conversationId, currentConversationId);
      currentConversationId = parsed.conversationId;
      pendingProjectId = conv.projectId;
      const messages = loadMessages(parsed.conversationId);
      send({ type: "messages", messages });
      send({ type: "conversation", conversation: conv });
      // Send current dev server status for this conversation
      if (conv.ports && Object.keys(conv.ports).length > 0) {
        const srvStatus = getServerStatus(parsed.conversationId);
        send({
          type: "server_status",
          conversationId: parsed.conversationId,
          status: srvStatus,
          ports: conv.ports,
        });
      }
      // Resume streaming if CLI is active for this conversation
      const cliEntry = cliProcesses.get(parsed.conversationId);
      if (cliEntry) {
        send({
          type: "streaming_resume",
          streamingText: cliEntry.streamingText,
          rawEvents: cliEntry.rawEvents,
        });
      }
      return;
    }

    // parsed is narrowed to PromptMessage here
    if (!parsed.text || parsed.text.length > 1_000_000) {
      send({ type: "error", data: !parsed.text ? "Empty prompt" : "Prompt too large (max 1MB)" });
      return;
    }

    // Require an active conversation (created via create_conversation)
    if (currentConversationId === null) {
      send({ type: "error", data: "No conversation selected" });
      return;
    }

    // Double-spawn guard
    if (cliProcesses.has(currentConversationId)) {
      send({ type: "error", data: "A process is already running" });
      return;
    }

    const conv = getConversation(currentConversationId);
    if (!conv) {
      send({ type: "error", data: "Conversation not found" });
      return;
    }
    if (conv.archived) {
      send({ type: "error", data: "Conversation is archived" });
      return;
    }

    const convId = currentConversationId;

    // Wait for pending git pull before spawning
    if (pendingGitPull) {
      const pull = pendingGitPull;
      pendingGitPull = null;
      await pull;
      // Re-check after await in case another handler snuck in
      if (cliProcesses.has(convId)) {
        send({ type: "error", data: "A process is already running" });
        return;
      }
    }

    // --- All guards passed. Commit side effects. ---
    touchConversation(convId);

    // Derive isFirstPrompt from stored messages (before appending user message)
    const isFirstPrompt = loadMessages(convId).length === 0;

    // Store user message
    const userMsg: UIMessage = {
      id: crypto.randomUUID(),
      type: "user",
      content: parsed.text,
    };
    appendMessage(convId, userMsg);

    // Resolve cwd: use worktree path when resuming, otherwise project root
    const project = pendingProjectId ? getProject(pendingProjectId) : null;
    const projectPath = project ? expandTilde(project.path) : undefined;
    const spawnCwd = !isFirstPrompt && conv.worktreeCwd ? conv.worktreeCwd : projectPath;
    if (spawnCwd && !fs.existsSync(spawnCwd)) {
      send({ type: "error", data: `Directory does not exist: ${spawnCwd}` });
      return;
    }

    const env = { ...process.env };
    delete env.CLAUDECODE;

    // First prompt: --session-id creates a new session with that UUID.
    // Subsequent prompts: --resume loads an existing session by UUID.
    // Using --session-id on an existing session fails with "already in use".
    const sessionFlag = isFirstPrompt ? "--session-id" : "--resume";
    const args = [sessionFlag, convId, "-p", "--output-format", "stream-json", "--verbose"];
    // -w creates a git worktree on the first prompt. On --resume, we set
    // cwd to the worktree path stored from the init event.
    if (isFirstPrompt) {
      args.push("-w", conv.slug);
    }
    args.push("--", parsed.text);

    const logProjectName = project?.name ?? "unknown";
    const logConvName = conv.name;
    if (isFirstPrompt) {
      console.log(
        `SESSION: [new] project="${logProjectName}" convo="${logConvName}" session=${convId}`,
      );
    }
    console.log(
      `USER: ${isFirstPrompt ? "[new session]" : "[resume]"} project="${logProjectName}" convo="${logConvName}" session=${convId} text=${JSON.stringify(parsed.text.length > 200 ? `${parsed.text.slice(0, 200)}...` : parsed.text)}`,
    );

    // --- doSpawn: spawn CLI and wire up handlers ---
    const child = spawn("claude", args, {
      stdio: ["pipe", "pipe", "pipe"],
      env,
      cwd: spawnCwd || undefined,
    });

    // Create entry and register in map immediately (synchronous with spawn)
    const entry = {
      process: child,
      killTimeout: null as ReturnType<typeof setTimeout> | null,
      streamingText: "",
      rawEvents: [] as Record<string, unknown>[],
    };
    cliProcesses.set(convId, entry);

    const shellCmd = `claude ${args.map((a) => (/[^a-zA-Z0-9_./:=-]/.test(a) ? `'${a.replace(/'/g, "'\\''")}'` : a)).join(" ")}`;
    console.log(
      `PROCESS: [start] pid=${child.pid} cwd=${spawnCwd || "none"} project="${logProjectName}" convo="${logConvName}" session=${convId}\n  $ ${shellCmd}`,
    );

    const onInitCwd = (cwd: string) => {
      console.log(`PROCESS: [init] pid=${child.pid} cwd=${cwd} session=${convId}`);
      setWorktreeCwd(convId, cwd);
      // Allocate ports from template files in the worktree (skip if already allocated)
      const existing = getConversation(convId);
      if (existing?.ports && Object.keys(existing.ports).length > 0) return;
      allocatePorts(convId, cwd)
        .then((ports) => {
          if (Object.keys(ports).length > 0) {
            console.log(`PORTS: [allocated] session=${convId} ports=${JSON.stringify(ports)}`);
            broadcastServerStatus(convId, "stopped", ports);
          }
        })
        .catch((err) => {
          console.error(`PORTS: [error] session=${convId} error=${(err as Error).message}`);
        });
    };

    const { stdin, stdout, stderr } = child;
    if (!stdin || !stdout || !stderr) {
      send({ type: "error", data: "Failed to attach to process stdio" });
      cliProcesses.delete(convId);
      return;
    }

    stdin.on("error", () => {
      /* ignore EPIPE — child may not read stdin */
    });
    stdin.end();

    let buffer = "";

    let stdoutBytes = 0;
    let stderrBytes = 0;
    let eventCount = 0;

    // Detect hung processes — if no stdout/stderr within 30s, warn
    const SPAWN_TIMEOUT_MS = 30_000;
    const spawnTimer = setTimeout(() => {
      if (stdoutBytes === 0 && stderrBytes === 0 && cliProcesses.get(convId)?.process === child) {
        console.error(
          `PROCESS: [timeout] pid=${child.pid} session=${convId} no output after ${SPAWN_TIMEOUT_MS / 1000}s — killing`,
        );
        sendToConversation(convId, {
          type: "error",
          data: "Claude CLI produced no output — process may be hung. Killed.",
        });
        killCLIProcess(convId);
      }
    }, SPAWN_TIMEOUT_MS);

    stdout.on("data", (chunk: Buffer) => {
      clearTimeout(spawnTimer);
      stdoutBytes += chunk.length;
      buffer += chunk.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        let event: unknown;
        try {
          event = JSON.parse(trimmed);
        } catch (e) {
          console.warn(
            `STREAM: [parse-error] pid=${child.pid} session=${convId} error=${(e as Error).message} line=${JSON.stringify(trimmed.slice(0, 200))}`,
          );
          continue;
        }
        if (typeof event !== "object" || event === null) continue;

        eventCount++;
        const ev = event as Record<string, unknown>;
        const eventType = ev.type as string;
        const eventSubtype = ev.subtype as string | undefined;
        if (eventCount <= 5 || eventType === "system" || eventType === "result") {
          console.log(
            `STREAM: [event] pid=${child.pid} session=${convId} #${eventCount} type=${eventType}${eventSubtype ? `.${eventSubtype}` : ""}`,
          );
        }

        // Broadcast to all clients watching this conversation
        const broadcastEvent = (msg: ServerMessage) => sendToConversation(convId, msg);
        handleNdjsonEvent(ev, broadcastEvent, entry, onInitCwd);
      }
    });

    stderr.on("data", (chunk: Buffer) => {
      clearTimeout(spawnTimer);
      stderrBytes += chunk.length;
      const text = chunk.toString().trim();
      if (text) {
        console.warn(
          `STDERR: pid=${child.pid} session=${convId} text=${JSON.stringify(text.slice(0, 500))}`,
        );
      }
      if (cliProcesses.get(convId)?.process === child) {
        sendToConversation(convId, { type: "stderr", data: chunk.toString() });
      }
    });

    child.on("error", (err: Error) => {
      console.error(
        `PROCESS: [error] pid=${child.pid} session=${convId} error=${JSON.stringify(err.message)} project="${logProjectName}" convo="${logConvName}"`,
      );
      if (cliProcesses.get(convId)?.process === child) {
        sendToConversation(convId, { type: "error", data: err.message });
        cliProcesses.delete(convId);
      }
    });

    child.on("close", (code: number | null) => {
      clearTimeout(spawnTimer);
      console.log(
        `PROCESS: [exit] pid=${child.pid} exitCode=${code} stdoutBytes=${stdoutBytes} stderrBytes=${stderrBytes} events=${eventCount} project="${logProjectName}" convo="${logConvName}" session=${convId}`,
      );
      const isActive = cliProcesses.get(convId)?.process === child;

      // Flush remaining buffer and send done if still the active process
      if (isActive) {
        if (buffer.trim()) {
          try {
            const final = JSON.parse(buffer.trim());
            if (typeof final === "object" && final !== null) {
              const broadcastEvent = (msg: ServerMessage) => sendToConversation(convId, msg);
              handleNdjsonEvent(final as Record<string, unknown>, broadcastEvent, entry, onInitCwd);
            }
          } catch {
            // ignore incomplete final line
          }
        }
        cliProcesses.delete(convId);
        sendToConversation(convId, { type: "done", exitCode: code });
      }

      // Persist accumulated text only for the active process. Killed processes
      // (isActive=false) are skipped to prevent stale partial output from a
      // killed CLI appearing as a duplicate message when a new prompt follows.
      if (!entry.streamingText && isActive) {
        console.log(
          `AGENT: [no response] project="${logProjectName}" convo="${logConvName}" session=${convId} exitCode=${code}`,
        );
      }
      if (entry.streamingText && isActive) {
        const responsePreview =
          entry.streamingText.length > 200
            ? `${entry.streamingText.slice(0, 200)}...`
            : entry.streamingText;
        console.log(
          `AGENT: project="${logProjectName}" convo="${logConvName}" session=${convId} text=${JSON.stringify(responsePreview)}`,
        );
        const assistantMsg: UIMessage = {
          id: crypto.randomUUID(),
          type: "assistant",
          content: entry.streamingText,
          streaming: false,
          ...(entry.rawEvents.length > 0 && { rawEvents: entry.rawEvents }),
        };
        appendMessage(convId, assistantMsg);
        touchConversation(convId);
        broadcastConversationList();
      }

      // Re-try port allocation if worktree exists but no ports
      // (e.g. setup prompt just created start.sh + PORTS)
      if (isActive && convId) {
        const doneConv = getConversation(convId);
        if (
          doneConv?.worktreeCwd &&
          (!doneConv.ports || Object.keys(doneConv.ports).length === 0)
        ) {
          allocatePorts(convId, doneConv.worktreeCwd)
            .then((ports) => {
              if (Object.keys(ports).length > 0) {
                console.log(
                  `PORTS: [retry-allocated] session=${convId} ports=${JSON.stringify(ports)}`,
                );
                broadcastServerStatus(convId, "stopped", ports);
              }
            })
            .catch((err) => {
              console.error(
                `PORTS: [retry-error] session=${convId} error=${(err as Error).message}`,
              );
            });
        }
      }
    });
  });

  ws.on("close", () => {
    console.log(`WS: [disconnected] clients=${wss.clients.size}`);
    untrackClient(ws, currentConversationId);
    // CLI process survives disconnects — it's module-scoped
  });
});

function handleNdjsonEvent(
  event: Record<string, unknown>,
  sendFn: (obj: ServerMessage) => void,
  ctx: { streamingText: string; rawEvents: Record<string, unknown>[] },
  onInitCwd?: (cwd: string) => void,
): void {
  // Skip storing content_block_delta — the text is already in ctx.streamingText
  if (event.type === "content_block_delta") {
    const delta = event.delta;
    if (typeof delta !== "object" || delta === null) return;
    const d = delta as Record<string, unknown>;
    if (d.type === "text_delta" && typeof d.text === "string") {
      ctx.streamingText += d.text;
      sendFn({ type: "text", data: d.text });
    }
    return;
  }

  // Store non-delta events (null-stripped) for persistence
  const stripped = stripNullValues(event) as Record<string, unknown>;
  ctx.rawEvents.push(stripped);

  if (event.type === "assistant") {
    // Extract text from the assistant message's content array, but only if
    // no content_block_delta events have arrived yet (to avoid double-counting)
    if (!ctx.streamingText) {
      const msg = event.message as Record<string, unknown> | undefined;
      const content = msg?.content;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (
            typeof block === "object" &&
            block !== null &&
            (block as Record<string, unknown>).type === "text"
          ) {
            const text = (block as Record<string, unknown>).text;
            if (typeof text === "string") {
              ctx.streamingText += text;
            }
          }
        }
      }
    }
    sendFn({ type: "assistant", data: stripped });
    return;
  }

  if (event.type === "result") {
    sendFn({ type: "result", data: event as ResultData });
    return;
  }

  if (event.type === "system") {
    if (event.subtype === "init" && typeof event.cwd === "string" && onInitCwd) {
      onInitCwd(event.cwd);
    }
    sendFn({ type: "system", data: event });
    return;
  }
}

// --- API catch-all 404 ---
app.all("/api/*", (_req, res) => {
  res.status(404).json({ error: "Not found" });
});

// --- SPA fallback (production only) ---
if (process.env.NODE_ENV === "production") {
  const clientDist = path.resolve(__dirname, "../client/dist");
  if (fs.existsSync(clientDist)) {
    app.use(express.static(clientDist));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(clientDist, "index.html"));
    });
  }
}

// Kill all spawned processes on server shutdown (e.g. tsx watch restart).
// Timers won't fire during shutdown so we SIGKILL directly
// instead of using the async SIGTERM+timeout flow.
function shutdownAll() {
  // Kill CLI processes (direct kill, not process group)
  for (const [, entry] of cliProcesses) {
    if (entry.killTimeout) clearTimeout(entry.killTimeout);
    try {
      entry.process.kill("SIGKILL");
    } catch {
      // already gone
    }
  }
  cliProcesses.clear();
  // Kill dev server processes (process group kill since they're detached)
  for (const [, entry] of serverProcesses) {
    if (entry.killTimeout) clearTimeout(entry.killTimeout);
    const pid = entry.process.pid;
    if (pid) {
      try {
        process.kill(-pid, "SIGKILL");
      } catch {
        // ESRCH — already gone
      }
    }
  }
  serverProcesses.clear();
  for (const client of wss.clients) {
    client.close();
  }
}
process.on("SIGTERM", shutdownAll);
process.on("SIGINT", shutdownAll);

server.listen(PORT, () => {
  console.log(`Catalyst Agent server listening on port ${PORT}`);
});
