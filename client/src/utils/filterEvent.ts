/**
 * Keys to strip from all objects at any depth.
 */
const GLOBALLY_STRIPPED_KEYS = new Set([
  "tool_use_id",
  "usage",
  "modelUsage",
  "total_cost_usd",
  "fast_mode_state",
  "noOutputExpected",
]);

/**
 * Recursively removes null values and globally-stripped keys from an object/array.
 */
function stripNulls(obj: unknown): unknown {
  if (obj === null || obj === "") return undefined;
  if (Array.isArray(obj)) {
    const arr = obj.map(stripNulls).filter((v) => v !== undefined);
    return arr.length === 0 ? undefined : arr;
  }
  if (typeof obj === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      if (GLOBALLY_STRIPPED_KEYS.has(key)) continue;
      const stripped = stripNulls(value);
      if (stripped !== undefined) {
        result[key] = stripped;
      }
    }
    return Object.keys(result).length === 0 ? undefined : result;
  }
  return obj;
}

/**
 * Events to drop entirely (not displayed in the UI).
 */
const IGNORED_EVENTS: readonly { type: string; subtype?: string }[] = [
  { type: "system", subtype: "hook_started" },
  { type: "system", subtype: "hook_response" },
  { type: "system", subtype: "init" },
  { type: "rate_limit_event" },
  { type: "content_block_delta" },
];

/**
 * Top-level keys to remove from ALL events.
 */
const GLOBAL_TOP_DENY = new Set(["session_id", "uuid"]);

/**
 * Additional top-level keys to remove from assistant events only.
 */
const ASSISTANT_TOP_DENY = new Set(["type"]);

/**
 * Keys to remove from the `message` sub-object of assistant events.
 */
const MESSAGE_DENY = new Set(["model", "id", "type", "usage"]);

/**
 * Keys to remove from content block objects inside message.content[].
 */
const CONTENT_BLOCK_DENY = new Set(["signature"]);

/**
 * Filters a single NDJSON event. Returns null if the event should be dropped.
 */
export function filterEvent(raw: Record<string, unknown>): Record<string, unknown> | null {
  // Drop ignored events
  for (const ignored of IGNORED_EVENTS) {
    if (raw.type === ignored.type && (!ignored.subtype || raw.subtype === ignored.subtype)) {
      return null;
    }
  }

  // Strip global deny-listed keys from all events
  const filtered: Record<string, unknown> = {};
  const isAssistant = raw.type === "assistant";
  for (const [key, value] of Object.entries(raw)) {
    if (GLOBAL_TOP_DENY.has(key)) continue;
    if (isAssistant && ASSISTANT_TOP_DENY.has(key)) continue;
    filtered[key] = value;
  }

  // Assistant-specific: filter message sub-object and content blocks
  if (isAssistant && typeof filtered.message === "object" && filtered.message !== null) {
    const msg = filtered.message as Record<string, unknown>;
    const filteredMsg: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(msg)) {
      if (!MESSAGE_DENY.has(key)) {
        filteredMsg[key] = value;
      }
    }

    if (Array.isArray(filteredMsg.content)) {
      filteredMsg.content = (filteredMsg.content as unknown[]).map((block) => {
        if (typeof block !== "object" || block === null) return block;
        const filteredBlock: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(block as Record<string, unknown>)) {
          if (!CONTENT_BLOCK_DENY.has(key)) {
            filteredBlock[key] = value;
          }
        }
        return filteredBlock;
      });
    }

    filtered.message = filteredMsg;
  }

  const result = stripNulls(filtered);
  if (result === undefined) return null;
  return result as Record<string, unknown>;
}
