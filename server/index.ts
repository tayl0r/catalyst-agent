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

const PORT = process.env.PORT || 3001;
const MAX_CONNECTIONS = 10;

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

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
      const id = crypto.randomUUID();
      const title = makeTitle(parsed.text);
      const conv = createConversation(id, title);
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

    const env = { ...process.env };
    delete env.CLAUDECODE;

    // Always use --session-id: it creates a new session if none exists,
    // or resumes an existing one. Safer than --resume which may not
    // accept a UUID argument in all CLI versions.
    const args = [
      "--session-id", currentConversationId,
      "-p", "--output-format", "stream-json", "--verbose",
    ];

    isFirstPrompt = false;

    const child = spawn("claude", args, {
      stdio: ["pipe", "pipe", "pipe"],
      env,
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

server.listen(PORT, () => {
  console.log(`cc-web server listening on port ${PORT}`);
});
