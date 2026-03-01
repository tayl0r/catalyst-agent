# cc-web

Browser-based web interface for the Claude CLI with real-time streaming chat.

## Commands

```bash
npm install          # Install root, server, and client deps (postinstall handles nested installs)
npm run dev          # Run server + client concurrently
npm run dev:server   # Server only (port 3001)
npm run dev:client   # Client only (port 5173)
```

Client build: `cd client && npm run build`

## Architecture

Three-tier: React client → WebSocket → Node server → spawned Claude CLI process.

```
client/          # React 19 + Vite + Tailwind CSS (ES modules)
  src/
    components/  # ChatMessage, InputArea, StatusIndicator
    hooks/       # useWebSocket - WebSocket lifecycle + message state
    App.jsx      # Root component
server/          # Express + ws library (CommonJS)
  index.js       # Monolithic server - HTTP, WebSocket, process management
```

## Tech Stack

- **Client:** React 19, Vite 6, Tailwind CSS 3, react-markdown + remark-gfm
- **Server:** Node.js, Express 4, ws (WebSocket)
- **Root:** concurrently (parallel dev scripts), npm workspaces-style postinstall

## Code Style

- JavaScript only (no TypeScript), no linter/formatter configured
- Client: ES modules, functional components with hooks, Tailwind utility classes
- Server: CommonJS (`require`), single-file architecture
- Components are small and focused; WebSocket logic lives in `useWebSocket` custom hook

## Gotchas

- **CLAUDECODE env var:** Server removes this before spawning Claude CLI to prevent "nested session" errors (server/index.js ~line 90)
- **NDJSON line buffering:** Claude CLI outputs newline-delimited JSON but chunks may split mid-line — server maintains a buffer and flushes incomplete lines on process close
- **Vite proxy required:** Client dev server proxies `/ws` to `localhost:3001` — without this, WebSocket connections fail in dev mode
- **Module system mismatch:** Client uses ES modules (`import`), server uses CommonJS (`require`)
- **Process kill flow:** SIGTERM first, then SIGKILL after 3s timeout if process doesn't exit
- **No tests:** Project has no test infrastructure — all testing is manual
