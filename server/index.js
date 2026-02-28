const express = require("express");
const http = require("http");
const { WebSocketServer } = require("ws");
const { spawn } = require("child_process");

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

wss.on("connection", (ws) => {
  let activeProcess = null;
  let killTimeout = null;

  function send(obj) {
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify(obj));
    }
  }

  function killProcess() {
    if (!activeProcess) return;
    const proc = activeProcess;
    activeProcess = null; // prevent double-kill orphaning timeouts
    try {
      proc.kill("SIGTERM");
    } catch (_) {
      // process already exited
      return;
    }
    killTimeout = setTimeout(() => {
      try {
        proc.kill("SIGKILL");
      } catch (_) {
        // process already exited
      }
    }, 3000);
  }

  function cleanup() {
    if (killTimeout) {
      clearTimeout(killTimeout);
      killTimeout = null;
    }
    activeProcess = null;
  }

  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      send({ type: "error", data: "Invalid JSON" });
      return;
    }

    if (msg.type === "kill") {
      killProcess();
      return;
    }

    if (msg.type !== "prompt" || !msg.text) {
      send({ type: "error", data: "Invalid message type" });
      return;
    }

    if (typeof msg.text !== "string" || msg.text.length > 1_000_000) {
      send({ type: "error", data: "Prompt too large (max 1MB)" });
      return;
    }

    if (activeProcess) {
      send({ type: "error", data: "A process is already running" });
      return;
    }

    // Build clean env without CLAUDECODE to avoid nested session error
    const env = { ...process.env };
    delete env.CLAUDECODE;

    // Set activeProcess synchronously before spawn returns to prevent races
    const args = [
      "-p",
      "--output-format",
      "stream-json",
      "--verbose",
      "--include-partial-messages",
    ];

    const child = spawn("claude", args, {
      stdio: ["pipe", "pipe", "pipe"],
      env,
    });

    activeProcess = child;

    // Write prompt via stdin to avoid ARG_MAX limits
    child.stdin.on("error", () => { /* ignore EPIPE */ });
    child.stdin.write(msg.text);
    child.stdin.end();

    // NDJSON line buffer
    let buffer = "";

    child.stdout.on("data", (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split("\n");
      // Keep last incomplete segment in buffer
      buffer = lines.pop();

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        let parsed;
        try {
          parsed = JSON.parse(trimmed);
        } catch {
          continue;
        }

        handleNdjsonEvent(parsed, send);
      }
    });

    child.stderr.on("data", (chunk) => {
      send({ type: "stderr", data: chunk.toString() });
    });

    child.on("error", (err) => {
      send({ type: "error", data: err.message });
      cleanup();
    });

    child.on("close", (code) => {
      // Process any remaining buffer
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

function handleNdjsonEvent(event, send) {
  // stream_event with content_block_delta containing text
  if (event.type === "content_block_delta") {
    if (event.delta?.type === "text_delta" && event.delta?.text) {
      send({ type: "text", data: event.delta.text });
    }
    return;
  }

  // Complete assistant message
  if (event.type === "assistant") {
    send({ type: "assistant", data: event });
    return;
  }

  // Result message with cost/usage
  if (event.type === "result") {
    send({ type: "result", data: event });
    return;
  }

  // System/init message
  if (event.type === "system") {
    send({ type: "system", data: event });
    return;
  }
}

server.listen(PORT, () => {
  console.log(`cc-web server listening on port ${PORT}`);
});
