import type { ServerMessage } from "@shared/types";
import { describe, expect, it, vi } from "vitest";
import { handleNdjsonEvent } from "../server/ndjson";

function makeCtx() {
  return { streamingText: "", rawEvents: [] as Record<string, unknown>[] };
}

function collectSends() {
  const sent: ServerMessage[] = [];
  return { sent, sendFn: (msg: ServerMessage) => sent.push(msg) };
}

describe("handleNdjsonEvent", () => {
  describe("content_block_delta", () => {
    it("accumulates text_delta into streamingText and sends text message", () => {
      const ctx = makeCtx();
      const { sent, sendFn } = collectSends();
      handleNdjsonEvent(
        { type: "content_block_delta", delta: { type: "text_delta", text: "hello" } },
        sendFn,
        ctx,
      );
      expect(ctx.streamingText).toBe("hello");
      expect(sent).toHaveLength(1);
      expect(sent[0]).toEqual({ type: "text", data: "hello" });
      expect(ctx.rawEvents).toHaveLength(0);
    });

    it("does nothing for non-text delta type", () => {
      const ctx = makeCtx();
      const { sent, sendFn } = collectSends();
      handleNdjsonEvent(
        { type: "content_block_delta", delta: { type: "input_json_delta", partial_json: "{}" } },
        sendFn,
        ctx,
      );
      expect(ctx.streamingText).toBe("");
      expect(sent).toHaveLength(0);
      expect(ctx.rawEvents).toHaveLength(0);
    });

    it("does nothing for null delta", () => {
      const ctx = makeCtx();
      const { sent, sendFn } = collectSends();
      handleNdjsonEvent({ type: "content_block_delta", delta: null }, sendFn, ctx);
      expect(ctx.streamingText).toBe("");
      expect(sent).toHaveLength(0);
      expect(ctx.rawEvents).toHaveLength(0);
    });
  });

  describe("assistant event", () => {
    it("strips nulls, pushes to rawEvents, and sends assistant message", () => {
      const ctx = makeCtx();
      const { sent, sendFn } = collectSends();
      handleNdjsonEvent(
        { type: "assistant", message: { content: [] }, extra: null },
        sendFn,
        ctx,
      );
      expect(ctx.rawEvents).toHaveLength(1);
      // null values stripped
      expect(ctx.rawEvents[0]).not.toHaveProperty("extra");
      expect(sent).toHaveLength(1);
      expect(sent[0].type).toBe("assistant");
    });

    it("extracts text from content blocks when no prior streaming", () => {
      const ctx = makeCtx();
      const { sendFn } = collectSends();
      handleNdjsonEvent(
        {
          type: "assistant",
          message: { content: [{ type: "text", text: "prefilled" }] },
        },
        sendFn,
        ctx,
      );
      expect(ctx.streamingText).toBe("prefilled");
    });

    it("does not double-count when streamingText already populated", () => {
      const ctx = makeCtx();
      ctx.streamingText = "already";
      const { sendFn } = collectSends();
      handleNdjsonEvent(
        {
          type: "assistant",
          message: { content: [{ type: "text", text: "extra" }] },
        },
        sendFn,
        ctx,
      );
      expect(ctx.streamingText).toBe("already");
    });
  });

  describe("result event", () => {
    it("sends raw event as result data and pushes stripped to rawEvents", () => {
      const ctx = makeCtx();
      const { sent, sendFn } = collectSends();
      const event = { type: "result", cost_usd: 0.01, extra: null };
      handleNdjsonEvent(event, sendFn, ctx);
      expect(sent).toHaveLength(1);
      expect(sent[0].type).toBe("result");
      // result sends the original event (not stripped) as data
      expect((sent[0] as { data: Record<string, unknown> }).data).toBe(event);
      // rawEvents gets the stripped version
      expect(ctx.rawEvents).toHaveLength(1);
      expect(ctx.rawEvents[0]).not.toHaveProperty("extra");
    });
  });

  describe("system event", () => {
    it("calls onInitCwd with cwd for init subtype", () => {
      const ctx = makeCtx();
      const { sent, sendFn } = collectSends();
      const onInitCwd = vi.fn();
      handleNdjsonEvent(
        { type: "system", subtype: "init", cwd: "/tmp/worktree" },
        sendFn,
        ctx,
        onInitCwd,
      );
      expect(onInitCwd).toHaveBeenCalledWith("/tmp/worktree");
      expect(sent).toHaveLength(1);
      expect(sent[0].type).toBe("system");
    });

    it("does not call onInitCwd for non-init system events", () => {
      const ctx = makeCtx();
      const { sent, sendFn } = collectSends();
      const onInitCwd = vi.fn();
      handleNdjsonEvent({ type: "system", subtype: "other" }, sendFn, ctx, onInitCwd);
      expect(onInitCwd).not.toHaveBeenCalled();
      expect(sent).toHaveLength(1);
    });
  });

  describe("unknown event type", () => {
    it("pushes stripped to rawEvents but does not send", () => {
      const ctx = makeCtx();
      const { sent, sendFn } = collectSends();
      handleNdjsonEvent({ type: "content_block_start", index: 0, foo: null }, sendFn, ctx);
      expect(ctx.rawEvents).toHaveLength(1);
      expect(ctx.rawEvents[0]).not.toHaveProperty("foo");
      expect(sent).toHaveLength(0);
    });
  });
});
