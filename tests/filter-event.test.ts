import { describe, expect, it } from "vitest";
import { filterEvent } from "../client/src/utils/filterEvent";

describe("filterEvent", () => {
  it("drops ignored event types", () => {
    expect(filterEvent({ type: "content_block_delta" })).toBeNull();
    expect(filterEvent({ type: "rate_limit_event" })).toBeNull();
  });

  it("drops ignored system subtypes", () => {
    expect(filterEvent({ type: "system", subtype: "init" })).toBeNull();
    expect(filterEvent({ type: "system", subtype: "hook_started" })).toBeNull();
    expect(filterEvent({ type: "system", subtype: "hook_response" })).toBeNull();
  });

  it("keeps non-ignored system events", () => {
    const result = filterEvent({ type: "system", subtype: "other", data: "test" });
    expect(result).not.toBeNull();
    expect(result?.subtype).toBe("other");
  });

  it("strips globally stripped keys", () => {
    const result = filterEvent({
      type: "assistant",
      message: { content: [{ type: "text", text: "hello" }] },
      tool_use_id: "abc",
      usage: { input: 100 },
    });
    expect(result).not.toBeNull();
  });

  it("strips session_id and uuid from top level", () => {
    const result = filterEvent({
      type: "result",
      session_id: "abc",
      uuid: "def",
      duration_ms: 100,
    });
    expect(result).not.toBeNull();
    expect(result).not.toHaveProperty("session_id");
    expect(result).not.toHaveProperty("uuid");
  });

  it("strips message deny-listed keys from assistant events", () => {
    const result = filterEvent({
      type: "assistant",
      message: {
        model: "claude-3",
        id: "msg_123",
        type: "message",
        usage: { input: 100 },
        content: [{ type: "text", text: "hello", signature: "sig123" }],
      },
    });
    expect(result).not.toBeNull();
    const msg = result?.message as Record<string, unknown>;
    expect(msg).not.toHaveProperty("model");
    expect(msg).not.toHaveProperty("id");
    expect(msg).not.toHaveProperty("usage");
    const content = msg?.content as Record<string, unknown>[];
    expect(content[0]).not.toHaveProperty("signature");
    expect(content[0]).toHaveProperty("text", "hello");
  });
});
