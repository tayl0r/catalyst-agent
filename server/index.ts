import express from "express";
import http from "http";
import { WebSocketServer, WebSocket } from "ws";
import { spawn, ChildProcess } from "child_process";
import { isClientMessage } from "@shared/types.js";
import type { ServerMessage, ResultData } from "@shared/types.js";

const PORT = process.env.PORT || 3001;

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

wss.on("connection", (ws: WebSocket) => {
  let activeProcess: ChildProcess | null = null;
  let killTimeout: ReturnType<typeof setTimeout> | null = null;

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

  function cleanup(): void {
    if (killTimeout) {
      clearTimeout(killTimeout);
      killTimeout = null;
    }
    activeProcess = null;
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

    // parsed is narrowed to PromptMessage here
    if (parsed.text.length > 1_000_000) {
      send({ type: "error", data: "Prompt too large (max 1MB)" });
      return;
    }

    if (activeProcess) {
      send({ type: "error", data: "A process is already running" });
      return;
    }

    const env = { ...process.env };
    // Remove CLAUDECODE to avoid nested session error from Claude CLI
    delete env.CLAUDECODE;

    const args = [
      "-p",
      "--output-format",
      "stream-json",
      "--verbose",
      "--include-partial-messages",
    ];

    // Set activeProcess synchronously before spawn returns to prevent races
    const child = spawn("claude", args, {
      stdio: ["pipe", "pipe", "pipe"],
      env,
    });

    activeProcess = child;

    // Write prompt via stdin to avoid ARG_MAX limits
    child.stdin!.on("error", () => { /* ignore EPIPE */ });
    child.stdin!.write(parsed.text);
    child.stdin!.end();

    // NDJSON line buffer — chunks may arrive mid-line
    let buffer = "";

    child.stdout!.on("data", (chunk: Buffer) => {
      buffer += chunk.toString();
      const lines = buffer.split("\n");
      // Keep last incomplete segment in buffer
      buffer = lines.pop()!;

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        let parsed: Record<string, unknown>;
        try {
          parsed = JSON.parse(trimmed);
        } catch {
          continue;
        }

        handleNdjsonEvent(parsed, send);
      }
    });

    child.stderr!.on("data", (chunk: Buffer) => {
      send({ type: "stderr", data: chunk.toString() });
    });

    child.on("error", (err: Error) => {
      send({ type: "error", data: err.message });
      cleanup();
    });

    child.on("close", (code: number | null) => {
      if (buffer.trim()) {
        try {
          const parsed = JSON.parse(buffer.trim());
          handleNdjsonEvent(parsed, send);
        } catch {
          // ignore incomplete final line
        }
      }
      send({ type: "done", exitCode: code });
      cleanup();
    });
  });

  ws.on("close", () => {
    killProcess();
  });
});

function handleNdjsonEvent(
  event: Record<string, unknown>,
  send: (obj: ServerMessage) => void,
): void {
  if (event.type === "content_block_delta") {
    const delta = event.delta as Record<string, unknown> | undefined;
    if (delta?.type === "text_delta" && delta.text) {
      send({ type: "text", data: delta.text as string });
    }
    return;
  }

  if (event.type === "assistant") {
    send({ type: "assistant", data: event as Record<string, unknown> });
    return;
  }

  if (event.type === "result") {
    send({ type: "result", data: event as ResultData });
    return;
  }

  if (event.type === "system") {
    send({ type: "system", data: event as Record<string, unknown> });
    return;
  }
}

server.listen(PORT, () => {
  console.log(`cc-web server listening on port ${PORT}`);
});
