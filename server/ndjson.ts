import type { ResultData, ServerMessage } from "@shared/types.js";
import { stripNullValues } from "./utils.js";

export function handleNdjsonEvent(
  event: Record<string, unknown>,
  sendFn: (obj: ServerMessage) => void,
  ctx: { streamingText: string; rawEvents: Record<string, unknown>[] },
  onInitCwd?: (cwd: string) => void,
): void {
  // Skip storing content_block_delta — the text is already in ctx.streamingText
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

  // Store non-delta events (null-stripped) for persistence
  const stripped = stripNullValues(event) as Record<string, unknown>;
  ctx.rawEvents.push(stripped);

  if (event.type === "assistant") {
    // Extract text from the assistant message's content array, but only if
    // no content_block_delta events have arrived yet (to avoid double-counting)
    if (!ctx.streamingText) {
      const msg = event.message as Record<string, unknown> | undefined;
      const content = msg?.content;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (
            typeof block === "object" &&
            block !== null &&
            (block as Record<string, unknown>).type === "text"
          ) {
            const text = (block as Record<string, unknown>).text;
            if (typeof text === "string") {
              ctx.streamingText += text;
            }
          }
        }
      }
    }
    sendFn({ type: "assistant", data: stripped });
    return;
  }

  if (event.type === "result") {
    sendFn({ type: "result", data: event as ResultData });
    return;
  }

  if (event.type === "system") {
    if (event.subtype === "init" && typeof event.cwd === "string" && onInitCwd) {
      onInitCwd(event.cwd);
    }
    sendFn({ type: "system", data: event });
    return;
  }
}
