# cc-web

Browser-based web interface for the Claude CLI with real-time streaming chat.

## Commands

```bash
npm install          # Install root, server, and client deps (postinstall handles nested installs)
npm run dev          # Run server + client in parallel (auto-kills previous instance via .dev.pid)
npm run dev:stop     # Stop the running dev server
npm run dev:server   # Server only (port 2999)
npm run dev:client   # Client only (port 2998)
```

Typecheck: `npm run typecheck` (both) / `cd server && npm run typecheck` / `cd client && npm run typecheck`

Lint: `npm run lint` (check) / `npm run lint:fix` (auto-fix) / `npm run format` (format only)

Client build: `cd client && npm run build`

## Architecture

Three-tier: React client → WebSocket → Node server → spawned Claude CLI process.

```
shared/          # Shared TypeScript types (imported by both client and server via @shared alias)
  types.ts       # ClientMessage, ServerMessage, UIMessage, Conversation, ConnectionStatus
client/          # React 19 + Vite + Tailwind CSS (TypeScript, ES modules)
  src/
    components/  # ChatMessage, InputArea, Sidebar, NewConversationModal, ServerPanel, StatusIndicator, StreamingIndicator
      events/    # EventRenderer, AskUserQuestionBlock, ResultSummary, TextBlock, ThinkingBlock, ToolUseBlock, ToolResultBlock
    hooks/       # useWebSocket (connection/messages), useProjects (project CRUD)
    pages/       # ChatPage, ProjectsPage
    utils/       # filterEvent (assistant event filtering)
    App.tsx      # Root component with react-router-dom routing
server/          # Express + ws library (TypeScript, ES modules, runs via tsx)
  index.ts       # HTTP, WebSocket, process management, session flags
  store.ts       # JSON file persistence for conversations and messages
  project-store.ts # Project CRUD operations
  port-allocator.ts # Port allocation for worktree dev servers (__PORT_N__ templates)
  utils.ts       # Shared server utilities (atomic writes, validation)
  data/          # Runtime data directory (gitignored)
    conversations/<uuid>.json
    messages/<uuid>.json
    projects.json
```

### Session Management

Each conversation gets a UUID. The Claude CLI is invoked with `--session-id <uuid>` on the first prompt (creates session) and `--resume <uuid>` on subsequent prompts (loads prior context). Conversation metadata and messages are persisted in `server/data/` as JSON files. The conversation record is created lazily on the first prompt, not on WebSocket connect.

## Tech Stack

- **Language:** TypeScript (strict mode), ES modules throughout
- **Client:** React 19, Vite 6, Tailwind CSS 3, react-markdown + remark-gfm
- **Server:** Node.js, Express 4, ws (WebSocket), tsx (runtime, no build step), JSON file storage (no external DB)
- **Root:** npm scripts with PID-tracked dev server (`.dev.pid`), auto-restart on `npm run dev`, explicit stop via `npm run dev:stop`

## Pre-commit

Always run `npm run lint:fix` before committing to ensure code passes linting and formatting.

## Code Style

- TypeScript with `strict: true`, Biome for linting + formatting (config at root `biome.json`)
- Client: functional components with hooks, Tailwind utility classes, prop interfaces on all components
- Server: index.ts (WebSocket/process management) + store.ts (persistence), ES module imports
- Components are small and focused; WebSocket logic lives in `useWebSocket` custom hook
- Shared types in `shared/types.ts`, imported via `@shared/types` path alias (configured in both tsconfig paths and vite resolve.alias)

## Gotchas

- **`@shared` path alias:** Configured in tsconfig `paths` AND `vite.config.js` `resolve.alias` — both must stay in sync
- **CLAUDECODE env var:** Server removes this before spawning Claude CLI to prevent "nested session" errors
- **Session flags:** First prompt uses `--session-id <uuid>`, subsequent prompts use `--resume <uuid>` — both combined with `-p` pipe mode
- **Lazy conversation creation:** Conversation DB records are created on first prompt, not on WebSocket connect, to avoid orphan records
- **Atomic file writes:** store.ts writes to `.tmp` then renames to prevent corruption from crashes
- **NDJSON line buffering:** Claude CLI outputs newline-delimited JSON but chunks may split mid-line — server maintains a buffer and flushes incomplete lines on process close
- **Vite proxy required:** Client dev server proxies `/ws` to the server port (see `vite.config.js`) — without this, WebSocket connections fail in dev mode
- **Process kill flow:** SIGTERM first, then SIGKILL after 3s timeout if process doesn't exit
- **Vite is transpile-only:** Vite does not run `tsc` — type errors won't fail the dev server or build. Run `npm run typecheck` separately
- **Port template variables:** Projects can include `start.sh` and `PORTS.md` with `__PORT_1__`, `__PORT_2__`, etc. as template variables (regex `/__PORT_(\d+)__/`); `port-allocator.ts` replaces these with real port numbers and writes `.local` output files
- **No tests:** Project has no test infrastructure — all testing is manual
