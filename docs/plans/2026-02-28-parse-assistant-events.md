# Parse & Display Assistant Events Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Parse Claude CLI NDJSON `assistant` events, apply a deny-list filter to strip noise fields and nulls, and display the filtered JSON in the chat UI.

**Architecture:** Client-side filtering. The server already forwards raw `assistant` events as `{ type: "assistant", data: event }`. We add a filter utility on the client, update the data model to carry structured event data alongside streaming text, and render filtered JSON as formatted `<pre>` blocks in ChatMessage.

**Tech Stack:** TypeScript, React 19, Tailwind CSS

---

### Task 1: Add filter utility

**Files:**
- Create: `client/src/utils/filterEvent.ts`

**Step 1: Create the filter utility**

```typescript
// client/src/utils/filterEvent.ts

/**
 * Recursively removes null values from an object/array.
 */
function stripNulls(obj: unknown): unknown {
  if (obj === null) return undefined;
  if (Array.isArray(obj)) {
    return obj.map(stripNulls).filter((v) => v !== undefined);
  }
  if (typeof obj === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      const stripped = stripNulls(value);
      if (stripped !== undefined) {
        result[key] = stripped;
      }
    }
    return result;
  }
  return obj;
}

/**
 * Top-level keys to remove from the raw assistant NDJSON event.
 */
const TOP_LEVEL_DENY = new Set(["type", "session_id", "uuid"]);

/**
 * Keys to remove from the `message` sub-object.
 */
const MESSAGE_DENY = new Set(["model", "id", "type", "usage"]);

/**
 * Filters a raw assistant NDJSON event:
 * 1. Removes deny-listed top-level keys
 * 2. Removes deny-listed message keys
 * 3. Recursively strips null values
 */
export function filterAssistantEvent(
  raw: Record<string, unknown>,
): Record<string, unknown> {
  // Step 1: remove top-level deny-listed keys
  const filtered: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!TOP_LEVEL_DENY.has(key)) {
      filtered[key] = value;
    }
  }

  // Step 2: remove deny-listed keys from message sub-object
  if (typeof filtered.message === "object" && filtered.message !== null) {
    const msg = filtered.message as Record<string, unknown>;
    const filteredMsg: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(msg)) {
      if (!MESSAGE_DENY.has(key)) {
        filteredMsg[key] = value;
      }
    }
    filtered.message = filteredMsg;
  }

  // Step 3: strip nulls recursively
  return stripNulls(filtered) as Record<string, unknown>;
}
```

**Step 2: Typecheck**

Run: `cd client && npm run typecheck`
Expected: PASS (no errors related to filterEvent.ts)

**Step 3: Commit**

```bash
git add client/src/utils/filterEvent.ts
git commit -m "feat: add filterAssistantEvent utility for deny-list filtering"
```

---

### Task 2: Update shared types for structured assistant data

**Files:**
- Modify: `shared/types.ts` (lines 175-179, AssistantUIMessage)

The current `AssistantUIMessage` stores content as a plain string. Add a `rawEvent` field to hold the filtered assistant event data.

**Step 1: Add rawEvent field to AssistantUIMessage**

In `shared/types.ts`, change:
```typescript
export interface AssistantUIMessage extends BaseUIMessage {
  type: "assistant";
  content: string;
  streaming: boolean;
}
```
to:
```typescript
export interface AssistantUIMessage extends BaseUIMessage {
  type: "assistant";
  content: string;
  streaming: boolean;
  rawEvent?: Record<string, unknown>;
}
```

**Step 2: Typecheck both client and server**

Run: `cd server && npm run typecheck && cd ../client && npm run typecheck`
Expected: PASS (rawEvent is optional so no existing code breaks)

**Step 3: Commit**

```bash
git add shared/types.ts
git commit -m "feat: add rawEvent field to AssistantUIMessage"
```

---

### Task 3: Store filtered events in useWebSocket

**Files:**
- Modify: `client/src/hooks/useWebSocket.ts` (lines 124-148, assistant case in onmessage switch)

When an `assistant` server message arrives, filter it with `filterAssistantEvent` and store the result on the current assistant message.

**Step 1: Import filterAssistantEvent**

Add at the top of `useWebSocket.ts`:
```typescript
import { filterAssistantEvent } from "../utils/filterEvent";
```

**Step 2: Update the `assistant` case in the switch**

Replace the existing `case "assistant":` block (lines ~124-148) with:

```typescript
        case "assistant": {
          if (discard) break;
          const filtered = filterAssistantEvent(msg.data as Record<string, unknown>);
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (last?.type === "assistant" && last.streaming) {
              return [
                ...prev.slice(0, -1),
                {
                  ...last,
                  content: streamingTextRef.current,
                  streaming: false,
                  rawEvent: filtered,
                },
              ];
            }
            return [
              ...prev,
              {
                id: createId(),
                type: "assistant",
                content: streamingTextRef.current || JSON.stringify(filtered),
                streaming: false,
                rawEvent: filtered,
              },
            ];
          });
          break;
        }
```

**Step 3: Typecheck**

Run: `cd client && npm run typecheck`
Expected: PASS

**Step 4: Commit**

```bash
git add client/src/hooks/useWebSocket.ts
git commit -m "feat: filter and store rawEvent on assistant messages"
```

---

### Task 4: Render filtered JSON in ChatMessage

**Files:**
- Modify: `client/src/components/ChatMessage.tsx` (lines 20-35, assistant rendering)

Replace the assistant message rendering to show the filtered JSON as a `<pre>` block.

**Step 1: Update the assistant rendering block**

Replace the `if (message.type === "assistant")` block (lines 20-35) with:

```typescript
  if (message.type === "assistant") {
    return (
      <div className="flex justify-start">
        <div className="max-w-[80%] rounded-2xl rounded-bl-md bg-gray-800 px-4 py-2.5">
          {message.rawEvent ? (
            <pre className="text-sm text-gray-200 whitespace-pre-wrap overflow-x-auto font-mono">
              {JSON.stringify(message.rawEvent, null, 2)}
            </pre>
          ) : (
            <div className="prose prose-invert prose-sm max-w-none">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {message.content}
              </ReactMarkdown>
            </div>
          )}
          {message.streaming && (
            <span className="inline-block h-4 w-1.5 animate-pulse bg-gray-400 ml-0.5" />
          )}
        </div>
      </div>
    );
  }
```

This shows the filtered JSON when `rawEvent` is present (after the assistant event arrives), and falls back to the markdown rendering during streaming (when only text deltas have arrived so far).

**Step 2: Typecheck**

Run: `cd client && npm run typecheck`
Expected: PASS

**Step 3: Manual test**

Run: `npm run dev`
1. Open browser to http://localhost:5173
2. Start a conversation and send a prompt
3. While streaming, you should see the text appearing with the cursor
4. Once the assistant event arrives, the message should switch to formatted JSON showing the filtered event

**Step 4: Commit**

```bash
git add client/src/components/ChatMessage.tsx
git commit -m "feat: render filtered assistant events as JSON in chat"
```
