import { type ChildProcess, spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { DevServerStatus, ResultData, ServerMessage, UIMessage } from "@shared/types.js";
import { isClientMessage, slugify } from "@shared/types.js";
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
  createConversation,
  deleteConversation as deleteConv,
  getConversation,
  getProjectSlugs,
  isValidConversationId,
  loadConversations,
  loadMessages,
  setDevServerStatus,
  setWorktreeCwd,
  touchConversation,
} from "./store.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({
  path: [path.resolve(__dirname, "../.env.local"), path.resolve(__dirname, "../.env")],
});

function stripNullValues(obj: unknown): unknown {
  if (obj === null) return undefined;
  if (Array.isArray(obj)) {
    return obj.map(stripNullValues).filter((v) => v !== undefined);
  }
  if (typeof obj === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      const stripped = stripNullValues(value);
      if (stripped !== undefined) {
        result[key] = stripped;
      }
    }
    return result;
  }
  return obj;
}

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
  return serverProcesses.has(conversationId) ? "running" : "stopped";
}

function killServerProcess(conversationId: string): void {
  const entry = serverProcesses.get(conversationId);
  if (!entry) return;
  const { process: proc, killTimeout } = entry;
  if (killTimeout) clearTimeout(killTimeout);

  broadcastServerStatus(conversationId, "stopping");

  const pid = proc.pid;
  if (pid) {
    try {
      process.kill(-pid, "SIGTERM");
    } catch {
      // ESRCH — process already gone
    }
    const timeout = setTimeout(() => {
      try {
        process.kill(-pid, "SIGKILL");
      } catch {
        // already gone
      }
      // Fallback cleanup if close event never fires
      setTimeout(() => {
        if (serverProcesses.has(conversationId)) {
          serverProcesses.delete(conversationId);
          broadcastServerStatus(conversationId, "stopped");
        }
      }, 2000);
    }, 3000);
    serverProcesses.set(conversationId, { process: proc, killTimeout: timeout });
  } else {
    serverProcesses.delete(conversationId);
    broadcastServerStatus(conversationId, "stopped");
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

  let activeProcess: ChildProcess | null = null;
  let killTimeout: ReturnType<typeof setTimeout> | null = null;
  let currentConversationId: string | null = null;
  let isFirstPrompt = true;
  let pendingProjectId: string | null = null;

  function send(obj: ServerMessage): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(obj));
    }
  }

  function killProcess(): void {
    if (!activeProcess) return;
    const proc = activeProcess;
    activeProcess = null;
    try {
      proc.kill("SIGTERM");
    } catch {
      return;
    }
    killTimeout = setTimeout(() => {
      try {
        proc.kill("SIGKILL");
      } catch {
        // process already exited
      }
    }, 3000);
  }

  function cleanup(child: ChildProcess): void {
    // Only clear activeProcess if this child is still the active one
    if (activeProcess === child) {
      activeProcess = null;
    }
    if (killTimeout) {
      clearTimeout(killTimeout);
      killTimeout = null;
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
      killProcess();
      return;
    }

    if (parsed.type === "list_conversations") {
      send({ type: "conversation_list", conversations: loadConversations() });
      return;
    }

    if (parsed.type === "delete_conversation") {
      if (!isValidConversationId(parsed.conversationId)) {
        send({ type: "error", data: "Invalid conversation ID" });
        return;
      }
      killServerProcess(parsed.conversationId);
      deleteConv(parsed.conversationId);
      // If we deleted the current conversation, reset state
      if (currentConversationId === parsed.conversationId) {
        killProcess();
        untrackClient(ws, currentConversationId);
        currentConversationId = null;
        pendingProjectId = null;
        isFirstPrompt = true;
      }
      // Clean up any other clients still tracked for this conversation
      conversationClients.delete(parsed.conversationId);
      // Broadcast deletion and updated list to all clients
      broadcast({ type: "conversation_deleted", conversationId: parsed.conversationId });
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
      serverChild.stdout?.on("data", (chunk: Buffer) => {
        if (firstOutput) {
          firstOutput = false;
          broadcastServerStatus(sConvId, "running");
        }
        sendToConversation(sConvId, {
          type: "server_output",
          conversationId: sConvId,
          data: chunk.toString(),
          stream: "stdout",
        });
      });
      serverChild.stderr?.on("data", (chunk: Buffer) => {
        if (firstOutput) {
          firstOutput = false;
          broadcastServerStatus(sConvId, "running");
        }
        sendToConversation(sConvId, {
          type: "server_output",
          conversationId: sConvId,
          data: chunk.toString(),
          stream: "stderr",
        });
      });
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
      killProcess();
      const conv = createConversation(id, trimmedName, slug, parsed.projectId);
      trackClient(ws, id, currentConversationId);
      currentConversationId = id;
      pendingProjectId = parsed.projectId;
      isFirstPrompt = true;
      send({ type: "conversation", conversation: conv });
      send({ type: "messages", messages: [] });
      broadcastConversationList();
      return;
    }

    if (parsed.type === "start") {
      killProcess();
      if (!isValidConversationId(parsed.conversationId)) {
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
      // If no messages exist, this conversation was created but never prompted —
      // use --session-id (first prompt) instead of --resume
      isFirstPrompt = messages.length === 0;
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
      return;
    }

    // parsed is narrowed to PromptMessage here
    if (!parsed.text || parsed.text.length > 1_000_000) {
      send({ type: "error", data: !parsed.text ? "Empty prompt" : "Prompt too large (max 1MB)" });
      return;
    }

    if (activeProcess) {
      send({ type: "error", data: "A process is already running" });
      return;
    }

    // Require an active conversation (created via create_conversation)
    if (currentConversationId === null) {
      send({ type: "error", data: "No conversation selected" });
      return;
    }

    const conv = getConversation(currentConversationId);
    if (!conv) {
      send({ type: "error", data: "Conversation not found" });
      return;
    }

    touchConversation(currentConversationId);

    // Store user message
    const userMsg: UIMessage = {
      id: crypto.randomUUID(),
      type: "user",
      content: parsed.text,
    };
    appendMessage(currentConversationId, userMsg);

    // Resolve cwd: use worktree path when resuming, otherwise project root
    const projectPath = pendingProjectId ? getProjectPath(pendingProjectId) : undefined;
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
    const args = [
      sessionFlag,
      currentConversationId,
      "-p",
      "--output-format",
      "stream-json",
      "--verbose",
    ];
    // -w creates a git worktree on the first prompt. On --resume, we set
    // cwd to the worktree path stored from the init event.
    if (isFirstPrompt) {
      args.push("-w", conv.slug);
    }
    args.push("--", parsed.text);

    const project = pendingProjectId ? getProject(pendingProjectId) : null;
    if (isFirstPrompt) {
      console.log(
        `SESSION: [new] project="${project?.name ?? "unknown"}" convo="${conv.name}" session=${currentConversationId}`,
      );
    }
    console.log(
      `USER: ${isFirstPrompt ? "[new session]" : "[resume]"} project="${project?.name ?? "unknown"}" convo="${conv.name}" session=${currentConversationId} text=${JSON.stringify(parsed.text.length > 200 ? `${parsed.text.slice(0, 200)}...` : parsed.text)}`,
    );

    isFirstPrompt = false;

    const convId = currentConversationId;
    const logProjectName = project?.name ?? "unknown";
    const logConvName = conv.name;

    const child = spawn("claude", args, {
      stdio: ["pipe", "pipe", "pipe"],
      env,
      cwd: spawnCwd || undefined,
    });

    activeProcess = child;
    const shellCmd = `claude ${args.map((a) => (/[^a-zA-Z0-9_./:=-]/.test(a) ? `'${a.replace(/'/g, "'\\''")}'` : a)).join(" ")}`;
    console.log(
      `PROCESS: [start] pid=${child.pid} cwd=${spawnCwd || "none"} project="${logProjectName}" convo="${logConvName}" session=${convId}\n  $ ${shellCmd}`,
    );

    // Per-prompt streaming context — not shared across prompts.
    // Each spawn gets its own accumulator so conversation switches
    // can't corrupt another prompt's stored text.
    const ctx: { streamingText: string; rawEvents: Record<string, unknown>[] } = {
      streamingText: "",
      rawEvents: [],
    };
    const onInitCwd = (cwd: string) => {
      if (convId) {
        console.log(`PROCESS: [init] pid=${child.pid} cwd=${cwd} session=${convId}`);
        setWorktreeCwd(convId, cwd);
        // Allocate ports from template files in the worktree
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
      }
    };

    const { stdin, stdout, stderr } = child;
    if (!stdin || !stdout || !stderr) {
      send({ type: "error", data: "Failed to attach to process stdio" });
      cleanup(child);
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
      if (stdoutBytes === 0 && stderrBytes === 0 && activeProcess === child) {
        console.error(
          `PROCESS: [timeout] pid=${child.pid} session=${convId} no output after ${SPAWN_TIMEOUT_MS / 1000}s — killing`,
        );
        send({
          type: "error",
          data: "Claude CLI produced no output — process may be hung. Killed.",
        });
        killProcess();
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

        // Only send to client if this is still the active process
        const sendFn = activeProcess === child ? send : () => {};
        handleNdjsonEvent(ev, sendFn, ctx, onInitCwd);
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
      if (activeProcess === child) {
        send({ type: "stderr", data: chunk.toString() });
      }
    });

    child.on("error", (err: Error) => {
      console.error(
        `PROCESS: [error] pid=${child.pid} session=${convId} error=${JSON.stringify(err.message)} project="${logProjectName}" convo="${logConvName}"`,
      );
      if (activeProcess === child) {
        send({ type: "error", data: err.message });
      }
      cleanup(child);
    });

    child.on("close", (code: number | null) => {
      clearTimeout(spawnTimer);
      console.log(
        `PROCESS: [exit] pid=${child.pid} exitCode=${code} stdoutBytes=${stdoutBytes} stderrBytes=${stderrBytes} events=${eventCount} project="${logProjectName}" convo="${logConvName}" session=${convId}`,
      );
      const isActive = activeProcess === child;

      // Only flush buffer and send done if still the active process
      if (isActive) {
        if (buffer.trim()) {
          try {
            const final = JSON.parse(buffer.trim());
            if (typeof final === "object" && final !== null) {
              handleNdjsonEvent(final as Record<string, unknown>, send, ctx, onInitCwd);
            }
          } catch {
            // ignore incomplete final line
          }
        }
        send({ type: "done", exitCode: code });
      }

      cleanup(child);

      // Always store accumulated text (even from killed processes)
      if (!ctx.streamingText && isActive) {
        // Only log no-response for processes that weren't intentionally killed
        console.log(
          `AGENT: [no response] project="${logProjectName}" convo="${logConvName}" session=${convId} exitCode=${code}`,
        );
      }
      if (ctx.streamingText && convId) {
        const responsePreview =
          ctx.streamingText.length > 200
            ? `${ctx.streamingText.slice(0, 200)}...`
            : ctx.streamingText;
        console.log(
          `AGENT: project="${logProjectName}" convo="${logConvName}" session=${convId} text=${JSON.stringify(responsePreview)}`,
        );
        const assistantMsg: UIMessage = {
          id: crypto.randomUUID(),
          type: "assistant",
          content: ctx.streamingText,
          streaming: false,
          ...(ctx.rawEvents.length > 0 && { rawEvents: ctx.rawEvents }),
        };
        appendMessage(convId, assistantMsg);
        touchConversation(convId);
        broadcastConversationList();
      }
    });
  });

  ws.on("close", () => {
    console.log(`WS: [disconnected] clients=${wss.clients.size}`);
    untrackClient(ws, currentConversationId);
    killProcess();
  });
});

function handleNdjsonEvent(
  event: Record<string, unknown>,
  sendFn: (obj: ServerMessage) => void,
  ctx: { streamingText: string; rawEvents: Record<string, unknown>[] },
  onInitCwd?: (cwd: string) => void,
): void {
  // Store every event (null-stripped) for persistence
  ctx.rawEvents.push(stripNullValues(event) as Record<string, unknown>);

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
    sendFn({ type: "assistant", data: stripNullValues(event) as Record<string, unknown> });
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
const clientDist = path.resolve(__dirname, "../client/dist");
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get("*", (_req, res) => {
    res.sendFile(path.join(clientDist, "index.html"));
  });
}

// Kill all spawned processes on server shutdown (e.g. tsx watch restart).
// Timers won't fire during shutdown so we SIGKILL process groups directly
// instead of using killServerProcess()'s async SIGTERM+timeout flow.
function shutdownAll() {
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
