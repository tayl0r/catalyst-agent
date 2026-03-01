import dotenv from "dotenv";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import express from "express";
import http from "http";
import crypto from "crypto";
import { WebSocketServer, WebSocket } from "ws";
import { spawn, ChildProcess } from "child_process";
import { isClientMessage } from "@shared/types.js";
import type { ServerMessage, ResultData, UIMessage } from "@shared/types.js";
import {
  isValidConversationId,
  loadConversations,
  getConversation,
  createConversation,
  touchConversation,
  deleteConversation as deleteConv,
  loadMessages,
  appendMessage,
} from "./store.js";
import {
  loadProjects,
  getProject,
  createProject,
  updateProject,
  deleteProject,
  populateFromDirectory,
  getProjectPath,
  expandTilde,
} from "./project-store.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: [path.resolve(__dirname, "../.env.local"), path.resolve(__dirname, "../.env")] });

const PORT = process.env.PORT || 3001;
const MAX_CONNECTIONS = 10;

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

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
  const { name, path: projectPath, description, color } = req.body;
  if (typeof name !== "string" || !name.trim()) {
    res.status(400).json({ error: "name is required" });
    return;
  }
  if (typeof projectPath !== "string" || !projectPath.trim()) {
    res.status(400).json({ error: "path is required" });
    return;
  }
  const resolvedPath = expandTilde(projectPath.trim());
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
  const project = createProject(name.trim(), resolvedPath, description?.trim(), color);
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
    res.status(409).json({ error: `Cannot delete: ${convs.length} conversation(s) reference this project` });
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

function makeTitle(text: string): string {
  const max = 80;
  if (text.length <= max) return text;
  const sentenceEnd = text.lastIndexOf(".", max);
  if (sentenceEnd > 20) return text.slice(0, sentenceEnd + 1);
  const wordEnd = text.lastIndexOf(" ", max);
  if (wordEnd > 20) return text.slice(0, wordEnd) + "...";
  return text.slice(0, max) + "...";
}

wss.on("connection", (ws: WebSocket) => {
  if (wss.clients.size > MAX_CONNECTIONS) {
    ws.close(1013, "Too many connections");
    return;
  }

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

  ws.on("message", (raw: Buffer) => {
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
      deleteConv(parsed.conversationId);
      // If we deleted the current conversation, reset state
      if (currentConversationId === parsed.conversationId) {
        killProcess();
        currentConversationId = null;
        isFirstPrompt = true;
      }
      // Broadcast deletion and updated list to all clients
      broadcast({ type: "conversation_deleted", conversationId: parsed.conversationId });
      broadcastConversationList();
      return;
    }

    if (parsed.type === "start") {
      killProcess();
      if (parsed.projectId) {
        pendingProjectId = parsed.projectId;
      }
      if (parsed.conversationId) {
        if (!isValidConversationId(parsed.conversationId)) {
          send({ type: "error", data: "Invalid conversation ID" });
          return;
        }
        const conv = getConversation(parsed.conversationId);
        if (!conv) {
          send({ type: "error", data: "Conversation not found" });
          return;
        }
        currentConversationId = parsed.conversationId;
        pendingProjectId = conv.projectId;
        isFirstPrompt = false;
        const messages = loadMessages(parsed.conversationId);
        send({ type: "messages", messages });
        send({ type: "conversation", conversation: conv });
      } else {
        currentConversationId = null;
        isFirstPrompt = true;
        send({ type: "conversation", conversation: null });
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

    // Conversation management
    if (currentConversationId === null) {
      if (!pendingProjectId) {
        send({ type: "error", data: "No project selected" });
        return;
      }
      const project = getProject(pendingProjectId);
      if (!project) {
        send({ type: "error", data: "Selected project not found" });
        return;
      }
      const id = crypto.randomUUID();
      const title = makeTitle(parsed.text);
      const conv = createConversation(id, title, pendingProjectId);
      currentConversationId = id;
      isFirstPrompt = true;
      send({ type: "conversation", conversation: conv });
      broadcastConversationList();
    } else {
      touchConversation(currentConversationId);
    }

    // Store user message
    const userMsg: UIMessage = {
      id: crypto.randomUUID(),
      type: "user",
      content: parsed.text,
    };
    appendMessage(currentConversationId, userMsg);

    // Resolve project cwd
    const projectPath = pendingProjectId ? getProjectPath(pendingProjectId) : undefined;
    if (projectPath && !fs.existsSync(projectPath)) {
      send({ type: "error", data: `Project directory does not exist: ${projectPath}` });
      return;
    }

    const env = { ...process.env };
    delete env.CLAUDECODE;

    // First prompt: --session-id creates a new session with that UUID.
    // Subsequent prompts: --resume loads an existing session by UUID.
    // Using --session-id on an existing session fails with "already in use".
    const sessionFlag = isFirstPrompt ? "--session-id" : "--resume";
    const args = [
      sessionFlag, currentConversationId,
      "-p", "--output-format", "stream-json", "--verbose",
    ];

    isFirstPrompt = false;

    const child = spawn("claude", args, {
      stdio: ["pipe", "pipe", "pipe"],
      env,
      cwd: projectPath || undefined,
    });

    activeProcess = child;

    // Per-prompt streaming context — not shared across prompts.
    // Each spawn gets its own accumulator so conversation switches
    // can't corrupt another prompt's stored text.
    const ctx = { streamingText: "" };

    const { stdin, stdout, stderr } = child;
    if (!stdin || !stdout || !stderr) {
      send({ type: "error", data: "Failed to attach to process stdio" });
      cleanup(child);
      return;
    }

    stdin.on("error", () => { /* ignore EPIPE */ });
    stdin.write(parsed.text);
    stdin.end();

    let buffer = "";
    const convId = currentConversationId;

    stdout.on("data", (chunk: Buffer) => {
      buffer += chunk.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        let event: unknown;
        try {
          event = JSON.parse(trimmed);
        } catch {
          continue;
        }
        if (typeof event !== "object" || event === null) continue;

        // Only send to client if this is still the active process
        const sendFn = activeProcess === child ? send : () => {};
        handleNdjsonEvent(event as Record<string, unknown>, sendFn, ctx);
      }
    });

    stderr.on("data", (chunk: Buffer) => {
      if (activeProcess === child) {
        send({ type: "stderr", data: chunk.toString() });
      }
    });

    child.on("error", (err: Error) => {
      if (activeProcess === child) {
        send({ type: "error", data: err.message });
      }
      cleanup(child);
    });

    child.on("close", (code: number | null) => {
      const isActive = activeProcess === child;

      // Only flush buffer and send done if still the active process
      if (isActive) {
        if (buffer.trim()) {
          try {
            const final = JSON.parse(buffer.trim());
            if (typeof final === "object" && final !== null) {
              handleNdjsonEvent(final as Record<string, unknown>, send, ctx);
            }
          } catch {
            // ignore incomplete final line
          }
        }
        send({ type: "done", exitCode: code });
      }

      cleanup(child);

      // Always store accumulated text (even from killed processes)
      if (ctx.streamingText && convId) {
        const assistantMsg: UIMessage = {
          id: crypto.randomUUID(),
          type: "assistant",
          content: ctx.streamingText,
          streaming: false,
        };
        appendMessage(convId, assistantMsg);
        touchConversation(convId);
        broadcastConversationList();
      }
    });
  });

  ws.on("close", () => {
    killProcess();
  });
});

function handleNdjsonEvent(
  event: Record<string, unknown>,
  sendFn: (obj: ServerMessage) => void,
  ctx: { streamingText: string },
): void {
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
    sendFn({ type: "assistant", data: event });
    return;
  }

  if (event.type === "result") {
    sendFn({ type: "result", data: event as ResultData });
    return;
  }

  if (event.type === "system") {
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

server.listen(PORT, () => {
  console.log(`cc-web server listening on port ${PORT}`);
});
