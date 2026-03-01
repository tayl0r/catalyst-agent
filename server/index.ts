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
    if (!parsed.text || parsed.text.length > 1_000_000) {
      send({ type: "error", data: !parsed.text ? "Empty prompt" : "Prompt too large (max 1MB)" });
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

    const { stdin, stdout, stderr } = child;
    if (!stdin || !stdout || !stderr) {
      send({ type: "error", data: "Failed to attach to process stdio" });
      cleanup();
      return;
    }

    // Write prompt via stdin to avoid ARG_MAX limits
    stdin.on("error", () => { /* ignore EPIPE */ });
    stdin.write(parsed.text);
    stdin.end();

    // NDJSON line buffer — chunks may arrive mid-line
    let buffer = "";

    stdout.on("data", (chunk: Buffer) => {
      buffer += chunk.toString();
      const lines = buffer.split("\n");
      // Keep last incomplete segment in buffer
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

        handleNdjsonEvent(event as Record<string, unknown>, send);
      }
    });

    stderr.on("data", (chunk: Buffer) => {
      send({ type: "stderr", data: chunk.toString() });
    });

    child.on("error", (err: Error) => {
      send({ type: "error", data: err.message });
      cleanup();
    });

    child.on("close", (code: number | null) => {
      if (buffer.trim()) {
        try {
          const final = JSON.parse(buffer.trim());
          if (typeof final === "object" && final !== null) {
            handleNdjsonEvent(final as Record<string, unknown>, send);
          }
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
    const delta = event.delta;
    if (typeof delta !== "object" || delta === null) return;
    const d = delta as Record<string, unknown>;
    if (d.type === "text_delta" && typeof d.text === "string") {
      send({ type: "text", data: d.text });
    }
    return;
  }

  if (event.type === "assistant") {
    send({ type: "assistant", data: event });
    return;
  }

  if (event.type === "result") {
    // Safe: ResultData has an index signature, so any Record<string, unknown> satisfies it
    send({ type: "result", data: event as ResultData });
    return;
  }

  if (event.type === "system") {
    send({ type: "system", data: event });
    return;
  }
}

server.listen(PORT, () => {
  console.log(`cc-web server listening on port ${PORT}`);
});
