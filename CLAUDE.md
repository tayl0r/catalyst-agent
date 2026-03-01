# cc-web

Browser-based web interface for the Claude CLI with real-time streaming chat.

## Commands

```bash
npm install          # Install root, server, and client deps (postinstall handles nested installs)
npm run dev          # Run server + client concurrently
npm run dev:server   # Server only (port 3001)
npm run dev:client   # Client only (port 5173)
```

Typecheck: `cd server && npm run typecheck` / `cd client && npm run typecheck`

Client build: `cd client && npm run build`

## Architecture

Three-tier: React client → WebSocket → Node server → spawned Claude CLI process.

```
shared/          # Shared TypeScript types (imported by both client and server via @shared alias)
  types.ts       # ClientMessage, ServerMessage, UIMessage, ConnectionStatus
client/          # React 19 + Vite + Tailwind CSS (TypeScript, ES modules)
  src/
    components/  # ChatMessage, InputArea, StatusIndicator
    hooks/       # useWebSocket - WebSocket lifecycle + message state
    App.tsx      # Root component
server/          # Express + ws library (TypeScript, ES modules, runs via tsx)
  index.ts       # Monolithic server - HTTP, WebSocket, process management
```

## Tech Stack

- **Language:** TypeScript (strict mode), ES modules throughout
- **Client:** React 19, Vite 6, Tailwind CSS 3, react-markdown + remark-gfm
- **Server:** Node.js, Express 4, ws (WebSocket), tsx (runtime, no build step)
- **Root:** concurrently (parallel dev scripts), npm workspaces-style postinstall

## Code Style

- TypeScript with `strict: true`, no linter/formatter configured
- Client: functional components with hooks, Tailwind utility classes, prop interfaces on all components
- Server: single-file architecture, ES module imports
- Components are small and focused; WebSocket logic lives in `useWebSocket` custom hook
- Shared types in `shared/types.ts`, imported via `@shared/types` path alias (configured in both tsconfig paths and vite resolve.alias)

## Gotchas

- **`@shared` path alias:** Configured in tsconfig `paths` AND `vite.config.js` `resolve.alias` — both must stay in sync
- **CLAUDECODE env var:** Server removes this before spawning Claude CLI to prevent "nested session" errors (server/index.ts ~line 90)
- **NDJSON line buffering:** Claude CLI outputs newline-delimited JSON but chunks may split mid-line — server maintains a buffer and flushes incomplete lines on process close
- **Vite proxy required:** Client dev server proxies `/ws` to `localhost:3001` — without this, WebSocket connections fail in dev mode
- **Process kill flow:** SIGTERM first, then SIGKILL after 3s timeout if process doesn't exit
- **Vite is transpile-only:** Vite does not run `tsc` — type errors won't fail the dev server or build. Run `npm run typecheck` separately
- **No tests:** Project has no test infrastructure — all testing is manual
