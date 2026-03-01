# JavaScript to TypeScript Migration Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Migrate the entire cc-web project (client + server) from JavaScript to TypeScript with `strict: true`.

**Architecture:** In-place migration — rename files, add tsconfigs, add type annotations. Server switches from CommonJS to ESM and uses `tsx` for zero-build-step development. Shared message types live in a root-level `shared/` directory importable by both client and server.

**Tech Stack:** TypeScript 5, tsx (server runtime), Vite (client — already supports TS), @types/react, @types/react-dom, @types/express, @types/ws

---

### Task 1: Install TypeScript dependencies for server

**Files:**
- Modify: `server/package.json`

**Step 1: Install deps**

Run:
```bash
cd /Users/taylor/dev/cc-web/server && npm install --save-dev typescript tsx @types/node @types/express @types/ws
```

**Step 2: Add `"type": "module"` and update scripts in `server/package.json`**

Change `server/package.json` to:
```json
{
  "name": "cc-web-server",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx index.ts",
    "start": "tsx index.ts",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "express": "^4.21.2",
    "ws": "^8.18.0"
  },
  "devDependencies": {
    "@types/express": "...",
    "@types/node": "...",
    "@types/ws": "...",
    "tsx": "...",
    "typescript": "..."
  }
}
```

(Keep whatever versions npm installed for devDependencies.)

**Step 3: Commit**

```bash
git add server/package.json server/package-lock.json
git commit -m "chore: add TypeScript deps to server"
```

---

### Task 2: Install TypeScript dependencies for client

**Files:**
- Modify: `client/package.json`

**Step 1: Install deps**

Run:
```bash
cd /Users/taylor/dev/cc-web/client && npm install --save-dev typescript @types/react @types/react-dom
```

**Step 2: Add typecheck script to `client/package.json` scripts**

Add to scripts:
```json
"typecheck": "tsc --noEmit"
```

**Step 3: Commit**

```bash
git add client/package.json client/package-lock.json
git commit -m "chore: add TypeScript deps to client"
```

---

### Task 3: Create shared message types

The client and server both need these types. They live in `shared/` at the project root so both can import them without cross-package issues.

**Files:**
- Create: `shared/types.ts`

**Step 1: Create `shared/types.ts`**

```typescript
// --- Client-to-server messages ---

export interface PromptMessage {
  type: "prompt";
  text: string;
}

export interface KillMessage {
  type: "kill";
}

export type ClientMessage = PromptMessage | KillMessage;

// --- Server-to-client messages ---

export interface TextMessage {
  type: "text";
  data: string;
}

export interface AssistantMessage {
  type: "assistant";
  data: Record<string, unknown>;
}

export interface ResultData {
  cost_usd?: number;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
  [key: string]: unknown;
}

export interface ResultMessage {
  type: "result";
  data: ResultData;
}

export interface SystemMessage {
  type: "system";
  data: Record<string, unknown>;
}

export interface ErrorMessage {
  type: "error";
  data: string;
}

export interface StderrMessage {
  type: "stderr";
  data: string;
}

export interface DoneMessage {
  type: "done";
  exitCode: number | null;
}

export type ServerMessage =
  | TextMessage
  | AssistantMessage
  | ResultMessage
  | SystemMessage
  | ErrorMessage
  | StderrMessage
  | DoneMessage;

// --- Client-side UI message types (different from wire types) ---

export interface UserUIMessage {
  type: "user";
  content: string;
}

export interface AssistantUIMessage {
  type: "assistant";
  content: string;
  streaming: boolean;
}

export interface ErrorUIMessage {
  type: "error";
  content: string;
}

export interface ResultUIMessage {
  type: "result";
  data: ResultData;
}

export interface SystemUIMessage {
  type: "system";
  data: Record<string, unknown>;
}

export type UIMessage =
  | UserUIMessage
  | AssistantUIMessage
  | ErrorUIMessage
  | ResultUIMessage
  | SystemUIMessage;

// --- Connection status ---

export type ConnectionStatus = "disconnected" | "connecting" | "connected";
```

**Step 2: Commit**

```bash
git add shared/
git commit -m "feat: add shared TypeScript message types"
```

---

### Task 4: Create tsconfig files

**Files:**
- Create: `server/tsconfig.json`
- Create: `client/tsconfig.json`

**Step 1: Create `server/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": ".",
    "baseUrl": ".",
    "paths": {
      "@shared/*": ["../shared/*"]
    }
  },
  "include": ["*.ts", "../shared/**/*.ts"]
}
```

Notes:
- `moduleResolution: "bundler"` instead of `"NodeNext"` — works cleanly with `tsx` and avoids the strict CJS default-import issues that `NodeNext` causes with express/ws.
- `esModuleInterop: true` — required for `import express from "express"` to work since express is a CJS package.
- `paths` alias for shared types — `tsx` respects tsconfig paths.

**Step 2: Create `client/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "jsx": "react-jsx",
    "baseUrl": ".",
    "paths": {
      "@shared/*": ["../shared/*"]
    }
  },
  "include": ["src/**/*.ts", "src/**/*.tsx", "../shared/**/*.ts"]
}
```

Notes:
- `jsx: "react-jsx"` — React 19's automatic JSX transform (no need to `import React`).
- `skipLibCheck: true` — avoids react-markdown v9 vs @types/react@19 type conflicts.
- Vite resolves paths via its own config, so we also need a vite alias (done in Task 7).

**Step 3: Commit**

```bash
git add server/tsconfig.json client/tsconfig.json
git commit -m "chore: add tsconfig.json for server and client"
```

---

### Task 5: Migrate server to TypeScript

**Files:**
- Rename: `server/index.js` → `server/index.ts`
- Modify: `server/index.ts` (add types, switch to ESM imports)

**Step 1: Rename the file**

```bash
cd /Users/taylor/dev/cc-web && git mv server/index.js server/index.ts
```

**Step 2: Rewrite `server/index.ts` with types and ESM imports**

Full replacement — convert `require` to `import`, add type annotations:

```typescript
import express from "express";
import http from "http";
import { WebSocketServer, WebSocket } from "ws";
import { spawn, ChildProcess } from "child_process";
import type { ClientMessage, ServerMessage } from "@shared/types.js";

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
    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw.toString()) as ClientMessage;
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

    const env = { ...process.env };
    delete env.CLAUDECODE;

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

    child.stdin!.on("error", () => { /* ignore EPIPE */ });
    child.stdin!.write(msg.text);
    child.stdin!.end();

    let buffer = "";

    child.stdout!.on("data", (chunk: Buffer) => {
      buffer += chunk.toString();
      const lines = buffer.split("\n");
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
    if (delta?.type === "text_delta" && typeof delta.text === "string") {
      send({ type: "text", data: delta.text });
    }
    return;
  }

  if (event.type === "assistant") {
    send({ type: "assistant", data: event as Record<string, unknown> });
    return;
  }

  if (event.type === "result") {
    send({ type: "result", data: event as Record<string, unknown> });
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
```

Key changes from the JS version:
- `require` → `import` (ESM)
- `ws.OPEN` → `WebSocket.OPEN` (static property, required by @types/ws)
- `child.stdin.write` → `child.stdin!.write` (non-null assertion — stdin exists because stdio is `"pipe"`)
- Explicit types on `activeProcess`, `killTimeout`, `buffer`, event handlers
- `handleNdjsonEvent` uses `Record<string, unknown>` for the raw NDJSON events and casts where needed

**Step 3: Run typecheck**

```bash
cd /Users/taylor/dev/cc-web/server && npx tsc --noEmit
```

Expected: 0 errors.

**Step 4: Smoke test — verify server starts**

```bash
cd /Users/taylor/dev/cc-web/server && npx tsx index.ts &
sleep 1
curl -s -o /dev/null -w "%{http_code}" http://localhost:3001
# Expected: some response (404 is fine — no routes defined on GET /)
kill %1
```

**Step 5: Commit**

```bash
git add server/
git commit -m "feat: migrate server to TypeScript with ESM imports"
```

---

### Task 6: Migrate client source files to TypeScript

**Files:**
- Rename: `client/src/main.jsx` → `client/src/main.tsx`
- Rename: `client/src/App.jsx` → `client/src/App.tsx`
- Rename: `client/src/hooks/useWebSocket.js` → `client/src/hooks/useWebSocket.ts`
- Rename: `client/src/components/ChatMessage.jsx` → `client/src/components/ChatMessage.tsx`
- Rename: `client/src/components/InputArea.jsx` → `client/src/components/InputArea.tsx`
- Rename: `client/src/components/StatusIndicator.jsx` → `client/src/components/StatusIndicator.tsx`

**Step 1: Rename all files**

```bash
cd /Users/taylor/dev/cc-web
git mv client/src/main.jsx client/src/main.tsx
git mv client/src/App.jsx client/src/App.tsx
git mv client/src/hooks/useWebSocket.js client/src/hooks/useWebSocket.ts
git mv client/src/components/ChatMessage.jsx client/src/components/ChatMessage.tsx
git mv client/src/components/InputArea.jsx client/src/components/InputArea.tsx
git mv client/src/components/StatusIndicator.jsx client/src/components/StatusIndicator.tsx
```

**Step 2: Update `client/src/main.tsx`**

Add non-null assertion for `document.getElementById`:

```tsx
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
```

Only change: `getElementById("root")` → `getElementById("root")!`

**Step 3: Update `client/src/hooks/useWebSocket.ts`**

Full replacement with types:

```typescript
import { useState, useEffect, useRef, useCallback } from "react";
import type { UIMessage, ConnectionStatus } from "@shared/types";

const RECONNECT_MIN = 1000;
const RECONNECT_MAX = 30000;

interface UseWebSocketReturn {
  status: ConnectionStatus;
  messages: UIMessage[];
  isProcessing: boolean;
  sendPrompt: (text: string) => void;
  killProcess: () => void;
  clearMessages: () => void;
}

export default function useWebSocket(): UseWebSocketReturn {
  const [status, setStatus] = useState<ConnectionStatus>("disconnected");
  const [messages, setMessages] = useState<UIMessage[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectDelay = useRef(RECONNECT_MIN);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const streamingTextRef = useRef("");
  const mountedRef = useRef(true);

  const getWsUrl = useCallback(() => {
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${proto}//${window.location.host}/ws`;
  }, []);

  const connect = useCallback(() => {
    if (
      wsRef.current?.readyState === WebSocket.OPEN ||
      wsRef.current?.readyState === WebSocket.CONNECTING
    ) return;

    setStatus("connecting");
    const ws = new WebSocket(getWsUrl());
    wsRef.current = ws;

    ws.onopen = () => {
      if (!mountedRef.current) return;
      setStatus("connected");
      reconnectDelay.current = RECONNECT_MIN;
    };

    ws.onmessage = (event: MessageEvent) => {
      if (!mountedRef.current) return;
      let msg: { type: string; data?: unknown };
      try {
        msg = JSON.parse(event.data as string);
      } catch {
        return;
      }

      switch (msg.type) {
        case "text":
          streamingTextRef.current += msg.data as string;
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (last?.type === "assistant" && last.streaming) {
              return [
                ...prev.slice(0, -1),
                { ...last, content: streamingTextRef.current },
              ];
            }
            return prev;
          });
          break;

        case "assistant":
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (last?.type === "assistant" && last.streaming) {
              return [
                ...prev.slice(0, -1),
                { type: "assistant" as const, content: streamingTextRef.current, streaming: false },
              ];
            }
            return [
              ...prev,
              { type: "assistant" as const, content: streamingTextRef.current || JSON.stringify(msg.data), streaming: false },
            ];
          });
          break;

        case "result":
          setMessages((prev) => [
            ...prev,
            { type: "result" as const, data: msg.data as UIMessage & { type: "result" } extends { data: infer D } ? D : never },
          ]);
          break;

        case "system":
          setMessages((prev) => [
            ...prev,
            { type: "system" as const, data: msg.data as Record<string, unknown> },
          ]);
          break;

        case "stderr":
          break;

        case "done":
          setIsProcessing(false);
          streamingTextRef.current = "";
          break;

        case "error":
          setMessages((prev) => [
            ...prev,
            { type: "error" as const, content: msg.data as string },
          ]);
          setIsProcessing(false);
          streamingTextRef.current = "";
          break;

        default:
          break;
      }
    };

    ws.onclose = () => {
      if (!mountedRef.current) return;
      setStatus("disconnected");
      setIsProcessing(false);

      reconnectTimer.current = setTimeout(() => {
        reconnectDelay.current = Math.min(
          reconnectDelay.current * 2,
          RECONNECT_MAX
        );
        connect();
      }, reconnectDelay.current);
    };

    ws.onerror = () => {
      // onclose will fire after onerror
    };
  }, [getWsUrl]);

  useEffect(() => {
    mountedRef.current = true;
    connect();
    return () => {
      mountedRef.current = false;
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
    };
  }, [connect]);

  const isProcessingRef = useRef(false);

  useEffect(() => {
    isProcessingRef.current = isProcessing;
  }, [isProcessing]);

  const sendPrompt = useCallback(
    (text: string) => {
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
      if (isProcessingRef.current) return;

      streamingTextRef.current = "";
      setIsProcessing(true);
      setMessages((prev) => [
        ...prev,
        { type: "user", content: text },
        { type: "assistant", content: "", streaming: true },
      ]);
      wsRef.current.send(JSON.stringify({ type: "prompt", text }));
    },
    []
  );

  const killProcess = useCallback(() => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify({ type: "kill" }));
  }, []);

  const clearMessages = useCallback(() => {
    if (isProcessingRef.current) {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: "kill" }));
      }
      setIsProcessing(false);
      streamingTextRef.current = "";
    }
    setMessages([]);
  }, []);

  return { status, messages, isProcessing, sendPrompt, killProcess, clearMessages };
}
```

Key changes:
- All `useRef(null)` calls get explicit generic types
- `useState` calls get type params: `useState<ConnectionStatus>`, `useState<UIMessage[]>`
- Return type interface defined
- Wire message parsed as `{ type: string; data?: unknown }` then narrowed per case
- `as const` assertions on message type literals for discriminated union narrowing

**Step 4: Update `client/src/components/StatusIndicator.tsx`**

```tsx
import type { ConnectionStatus } from "@shared/types";

interface StatusIndicatorProps {
  status: ConnectionStatus;
}

export default function StatusIndicator({ status }: StatusIndicatorProps) {
  const color =
    status === "connected"
      ? "bg-green-500"
      : status === "connecting"
        ? "bg-yellow-500"
        : "bg-red-500";

  const label =
    status === "connected"
      ? "Connected"
      : status === "connecting"
        ? "Connecting..."
        : "Disconnected";

  return (
    <div className="flex items-center gap-2 text-sm text-gray-400">
      <div className={`h-2 w-2 rounded-full ${color}`} />
      <span>{label}</span>
    </div>
  );
}
```

**Step 5: Update `client/src/components/InputArea.tsx`**

```tsx
import { useState, useRef, useEffect } from "react";

interface InputAreaProps {
  onSend: (text: string) => void;
  onStop: () => void;
  isProcessing: boolean;
  disabled: boolean;
}

export default function InputArea({
  onSend,
  onStop,
  isProcessing,
  disabled,
}: InputAreaProps) {
  const [text, setText] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height =
        Math.min(textareaRef.current.scrollHeight, 200) + "px";
    }
  }, [text]);

  const handleSubmit = () => {
    const trimmed = text.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setText("");
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (isProcessing) return;
      handleSubmit();
    }
  };

  return (
    <div className="border-t border-gray-800 bg-gray-950 p-4">
      <div className="mx-auto flex max-w-3xl items-end gap-3">
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Send a message..."
          disabled={disabled}
          rows={1}
          className="flex-1 resize-none rounded-xl border border-gray-700 bg-gray-900 px-4 py-3 text-gray-100 placeholder-gray-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50"
        />
        {isProcessing ? (
          <button
            onClick={onStop}
            className="rounded-xl bg-red-600 px-4 py-3 font-medium text-white hover:bg-red-700 transition-colors"
          >
            Stop
          </button>
        ) : (
          <button
            onClick={handleSubmit}
            disabled={disabled || !text.trim()}
            className="rounded-xl bg-blue-600 px-4 py-3 font-medium text-white hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Send
          </button>
        )}
      </div>
    </div>
  );
}
```

**Step 6: Update `client/src/components/ChatMessage.tsx`**

```tsx
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { UIMessage } from "@shared/types";

interface ChatMessageProps {
  message: UIMessage;
}

export default function ChatMessage({ message }: ChatMessageProps) {
  if (message.type === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded-2xl rounded-br-md bg-blue-600 px-4 py-2.5 text-white">
          <p className="whitespace-pre-wrap">{message.content}</p>
        </div>
      </div>
    );
  }

  if (message.type === "assistant") {
    return (
      <div className="flex justify-start">
        <div className="max-w-[80%] rounded-2xl rounded-bl-md bg-gray-800 px-4 py-2.5">
          <div className="prose prose-invert prose-sm max-w-none">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {message.content}
            </ReactMarkdown>
          </div>
          {message.streaming && (
            <span className="inline-block h-4 w-1.5 animate-pulse bg-gray-400 ml-0.5" />
          )}
        </div>
      </div>
    );
  }

  if (message.type === "error") {
    return (
      <div className="flex justify-start">
        <div className="max-w-[80%] rounded-2xl bg-red-900/50 border border-red-700 px-4 py-2.5 text-red-200">
          <p className="text-sm">{message.content}</p>
        </div>
      </div>
    );
  }

  if (message.type === "result") {
    const { data } = message;
    const cost = data.cost_usd != null ? `$${data.cost_usd.toFixed(4)}` : null;
    const inputTokens = data.usage?.input_tokens;
    const outputTokens = data.usage?.output_tokens;

    return (
      <div className="flex justify-center">
        <div className="text-xs text-gray-500 flex gap-3">
          {cost && <span>{cost}</span>}
          {inputTokens != null && <span>{inputTokens.toLocaleString()} in</span>}
          {outputTokens != null && <span>{outputTokens.toLocaleString()} out</span>}
        </div>
      </div>
    );
  }

  return null;
}
```

Key change: Props typed via `UIMessage` discriminated union. TypeScript narrows after each `if (message.type === "...")` check, so `message.content`, `message.data`, `message.streaming` all resolve correctly.

**Step 7: Update `client/src/App.tsx`**

```tsx
import { useEffect, useRef } from "react";
import useWebSocket from "./hooks/useWebSocket";
import StatusIndicator from "./components/StatusIndicator";
import ChatMessage from "./components/ChatMessage";
import InputArea from "./components/InputArea";

export default function App() {
  const { status, messages, isProcessing, sendPrompt, killProcess, clearMessages } =
    useWebSocket();
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  return (
    <div className="flex h-screen flex-col bg-gray-950 font-mono">
      {/* Header */}
      <header className="flex items-center justify-between border-b border-gray-800 px-4 py-3">
        <h1 className="text-lg font-semibold text-gray-100">cc-web</h1>
        <div className="flex items-center gap-4">
          <button
            onClick={clearMessages}
            className="text-sm text-gray-500 hover:text-gray-300 transition-colors"
          >
            Clear
          </button>
          <StatusIndicator status={status} />
        </div>
      </header>

      {/* Messages */}
      <main className="flex-1 overflow-y-auto px-4 py-6">
        <div className="mx-auto max-w-3xl space-y-4">
          {messages.length === 0 && (
            <div className="flex h-full items-center justify-center pt-32">
              <p className="text-gray-600 text-sm">
                Send a message to start a conversation with Claude.
              </p>
            </div>
          )}
          {messages.map((msg, i) => (
            <ChatMessage key={i} message={msg} />
          ))}
          <div ref={messagesEndRef} />
        </div>
      </main>

      {/* Input */}
      <InputArea
        onSend={sendPrompt}
        onStop={killProcess}
        isProcessing={isProcessing}
        disabled={status !== "connected"}
      />
    </div>
  );
}
```

Only change: `useRef(null)` → `useRef<HTMLDivElement | null>(null)`.

**Step 8: Commit**

```bash
git add client/src/
git commit -m "feat: migrate client source files to TypeScript"
```

---

### Task 7: Fix config files and entry point

**Files:**
- Modify: `client/index.html` (update script src)
- Modify: `client/tailwind.config.js` (update content glob)
- Modify: `client/vite.config.js` (add path alias for @shared)

**Step 1: Update `client/index.html` script tag**

Change line 10:
```html
<script type="module" src="/src/main.tsx"></script>
```

(Was `/src/main.jsx` — Vite resolves entry points from index.html literally.)

**Step 2: Update `client/tailwind.config.js` content glob**

Change line 2:
```js
content: ["./index.html", "./src/**/*.{ts,tsx}"],
```

(Was `*.{js,jsx}` — after rename, Tailwind's content scanner would miss all files and purge every utility class in production.)

**Step 3: Update `client/vite.config.js` to resolve @shared path alias**

```js
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@shared": path.resolve(__dirname, "../shared"),
    },
  },
  server: {
    proxy: {
      "/ws": {
        target: "http://localhost:3001",
        ws: true,
        changeOrigin: true,
      },
    },
  },
});
```

Vite does not read tsconfig paths — it needs its own alias config to resolve `@shared/types` imports.

**Step 4: Commit**

```bash
git add client/index.html client/tailwind.config.js client/vite.config.js
git commit -m "fix: update entry point, tailwind glob, and vite alias for TS migration"
```

---

### Task 8: Run typechecks and verify everything works

**Step 1: Run server typecheck**

```bash
cd /Users/taylor/dev/cc-web/server && npx tsc --noEmit
```

Expected: 0 errors.

**Step 2: Run client typecheck**

```bash
cd /Users/taylor/dev/cc-web/client && npx tsc --noEmit
```

Expected: 0 errors. If react-markdown types cause issues, `skipLibCheck: true` in tsconfig should suppress them.

**Step 3: Run `npm run dev` from root and verify app works**

```bash
cd /Users/taylor/dev/cc-web && npm run dev
```

- Server should start on port 3001 with tsx
- Client should start on port 5173 with Vite
- Opening http://localhost:5173 should show the chat UI
- Sending a message should stream a response from Claude

**Step 4: Fix any type errors found**

Iterate until both typechecks pass cleanly.

**Step 5: Commit any fixes**

```bash
git add -A
git commit -m "fix: resolve type errors from migration"
```

---

### Task 9: Update CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

**Step 1: Update CLAUDE.md to reflect TypeScript migration**

Key changes:
- Tech stack: TypeScript instead of JavaScript
- Commands: add `typecheck` commands
- Code style: update to reflect TS, ESM everywhere, strict mode
- Remove "no TypeScript" and "CommonJS" references from Gotchas
- Add note about `@shared/types` path alias

**Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md for TypeScript migration"
```

---

## Summary of all tasks

| # | Task | Files touched | Risk |
|---|------|--------------|------|
| 1 | Install server TS deps | server/package.json | Low |
| 2 | Install client TS deps | client/package.json | Low |
| 3 | Create shared types | shared/types.ts | Low |
| 4 | Create tsconfig files | server/tsconfig.json, client/tsconfig.json | Medium — config choices affect everything |
| 5 | Migrate server | server/index.ts | Medium — CJS→ESM + type annotations |
| 6 | Migrate client | 6 files in client/src/ | Medium — discriminated union typing |
| 7 | Fix configs | index.html, tailwind.config.js, vite.config.js | High — silent breakage if missed |
| 8 | Typecheck & verify | All | Verification step |
| 9 | Update CLAUDE.md | CLAUDE.md | Low |
