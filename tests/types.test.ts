import { describe, expect, it } from "vitest";
import { isClientMessage, isServerMessage } from "../shared/types";

describe("isClientMessage", () => {
  it("accepts valid prompt message", () => {
    expect(isClientMessage({ type: "prompt", text: "hello" })).toBe(true);
  });

  it("accepts kill message", () => {
    expect(isClientMessage({ type: "kill" })).toBe(true);
  });

  it("accepts create_conversation message", () => {
    expect(
      isClientMessage({ type: "create_conversation", name: "test", projectId: "abc" }),
    ).toBe(true);
  });

  it("accepts start message", () => {
    expect(isClientMessage({ type: "start", conversationId: "abc" })).toBe(true);
  });

  it("rejects invalid messages", () => {
    expect(isClientMessage(null)).toBe(false);
    expect(isClientMessage({})).toBe(false);
    expect(isClientMessage({ type: "unknown" })).toBe(false);
    expect(isClientMessage({ type: "prompt" })).toBe(false); // missing text
  });
});

describe("isServerMessage", () => {
  it("accepts valid server message types", () => {
    expect(isServerMessage({ type: "text", data: "hello" })).toBe(true);
    expect(isServerMessage({ type: "done", exitCode: 0 })).toBe(true);
    expect(isServerMessage({ type: "error", data: "err" })).toBe(true);
    expect(isServerMessage({ type: "conversation_list", conversations: [] })).toBe(true);
  });

  it("rejects invalid messages", () => {
    expect(isServerMessage(null)).toBe(false);
    expect(isServerMessage({})).toBe(false);
    expect(isServerMessage({ type: "not_a_type" })).toBe(false);
  });
});
