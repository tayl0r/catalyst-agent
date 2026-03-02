import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Conversation } from "@shared/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createStore } from "../server/store";

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "store-test-"));
}

describe("store", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function makeStore() {
    return createStore(tmpDir);
  }

  describe("createConversation", () => {
    it("returns correct shape", () => {
      const store = makeStore();
      const id = crypto.randomUUID();
      const conv = store.createConversation(id, "Test", "test", "proj-1");
      expect(conv.id).toBe(id);
      expect(conv.name).toBe("Test");
      expect(conv.slug).toBe("test");
      expect(conv.projectId).toBe("proj-1");
      expect(conv.created_at).toBeTruthy();
      expect(conv.updated_at).toBeTruthy();
    });

    it("persists to disk", () => {
      const store = makeStore();
      const id = crypto.randomUUID();
      store.createConversation(id, "Test", "test", "proj-1");
      const filePath = path.join(tmpDir, "conversations", `${id}.json`);
      expect(fs.existsSync(filePath)).toBe(true);
      const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      expect(data.id).toBe(id);
    });

    it("appears in index", () => {
      const store = makeStore();
      const id = crypto.randomUUID();
      store.createConversation(id, "Test", "test", "proj-1");
      expect(store.getConversation(id)).toBeDefined();
    });
  });

  describe("getConversation", () => {
    it("returns existing conversation", () => {
      const store = makeStore();
      const id = crypto.randomUUID();
      store.createConversation(id, "Test", "test", "proj-1");
      const conv = store.getConversation(id);
      expect(conv?.name).toBe("Test");
    });

    it("returns undefined for missing ID", () => {
      const store = makeStore();
      expect(store.getConversation(crypto.randomUUID())).toBeUndefined();
    });

    it("returns undefined for invalid ID", () => {
      const store = makeStore();
      expect(store.getConversation("not-a-uuid")).toBeUndefined();
    });
  });

  describe("loadConversations", () => {
    it("returns all created conversations", () => {
      const store = makeStore();
      store.createConversation(crypto.randomUUID(), "A", "a", "proj-1");
      store.createConversation(crypto.randomUUID(), "B", "b", "proj-1");
      expect(store.loadConversations()).toHaveLength(2);
    });
  });

  describe("getProjectSlugs", () => {
    it("filters by projectId", () => {
      const store = makeStore();
      store.createConversation(crypto.randomUUID(), "A", "a", "proj-1");
      store.createConversation(crypto.randomUUID(), "B", "b", "proj-2");
      store.createConversation(crypto.randomUUID(), "C", "c", "proj-1");
      expect(store.getProjectSlugs("proj-1").sort()).toEqual(["a", "c"]);
      expect(store.getProjectSlugs("proj-2")).toEqual(["b"]);
    });
  });

  describe("appendMessage + loadMessages", () => {
    it("round-trips messages", () => {
      const store = makeStore();
      const convId = crypto.randomUUID();
      store.createConversation(convId, "Test", "test", "proj-1");
      const msg = { id: crypto.randomUUID(), type: "user" as const, content: "hello" };
      store.appendMessage(convId, msg);
      const messages = store.loadMessages(convId);
      expect(messages).toHaveLength(1);
      expect(messages[0].content).toBe("hello");
    });
  });

  describe("touchConversation", () => {
    it("updates updated_at", () => {
      vi.useFakeTimers();
      try {
        const store = makeStore();
        const id = crypto.randomUUID();
        const conv = store.createConversation(id, "Test", "test", "proj-1");
        const before = conv.updated_at;
        vi.advanceTimersByTime(1000);
        store.touchConversation(id);
        const after = store.getConversation(id)!.updated_at;
        expect(after).not.toBe(before);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe("archiveConversation", () => {
    it("sets archived and clears transient fields", () => {
      const store = makeStore();
      const id = crypto.randomUUID();
      store.createConversation(id, "Test", "test", "proj-1");
      store.setWorktreeCwd(id, "/tmp/wt");
      store.setConversationPorts(id, { __PORT_1__: 3000 });
      store.setDevServerStatus(id, "running");
      const archived = store.archiveConversation(id);
      expect(archived?.archived).toBe(true);
      expect(archived?.worktreeCwd).toBeUndefined();
      expect(archived?.ports).toBeUndefined();
      expect(archived?.devServerStatus).toBeUndefined();
    });

    it("updates updated_at", () => {
      vi.useFakeTimers();
      try {
        const store = makeStore();
        const id = crypto.randomUUID();
        const conv = store.createConversation(id, "Test", "test", "proj-1");
        const before = conv.updated_at;
        vi.advanceTimersByTime(1000);
        store.archiveConversation(id);
        const after = store.getConversation(id)!.updated_at;
        expect(after).not.toBe(before);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe("deleteConversation", () => {
    it("removes from index and disk", () => {
      const store = makeStore();
      const id = crypto.randomUUID();
      store.createConversation(id, "Test", "test", "proj-1");
      store.appendMessage(id, { id: crypto.randomUUID(), type: "user", content: "hi" });
      store.deleteConversation(id);
      expect(store.getConversation(id)).toBeUndefined();
      expect(fs.existsSync(path.join(tmpDir, "conversations", `${id}.json`))).toBe(false);
      expect(fs.existsSync(path.join(tmpDir, "messages", `${id}.json`))).toBe(false);
    });
  });

  describe("setWorktreeCwd", () => {
    it("patches correctly", () => {
      const store = makeStore();
      const id = crypto.randomUUID();
      store.createConversation(id, "Test", "test", "proj-1");
      store.setWorktreeCwd(id, "/tmp/worktree");
      expect(store.getConversation(id)?.worktreeCwd).toBe("/tmp/worktree");
    });
  });

  describe("setConversationPorts", () => {
    it("patches correctly", () => {
      const store = makeStore();
      const id = crypto.randomUUID();
      store.createConversation(id, "Test", "test", "proj-1");
      store.setConversationPorts(id, { __PORT_1__: 3001 });
      expect(store.getConversation(id)?.ports).toEqual({ __PORT_1__: 3001 });
    });
  });

  describe("setDevServerStatus", () => {
    it("patches correctly", () => {
      const store = makeStore();
      const id = crypto.randomUUID();
      store.createConversation(id, "Test", "test", "proj-1");
      store.setDevServerStatus(id, "running");
      expect(store.getConversation(id)?.devServerStatus).toBe("running");
    });

    it("clears status when set to stopped", () => {
      const store = makeStore();
      const id = crypto.randomUUID();
      store.createConversation(id, "Test", "test", "proj-1");
      store.setDevServerStatus(id, "running");
      store.setDevServerStatus(id, "stopped");
      expect(store.getConversation(id)?.devServerStatus).toBeUndefined();
    });
  });

  describe("getAllUsedPorts", () => {
    it("aggregates across conversations", () => {
      const store = makeStore();
      const id1 = crypto.randomUUID();
      const id2 = crypto.randomUUID();
      store.createConversation(id1, "A", "a", "proj-1");
      store.createConversation(id2, "B", "b", "proj-1");
      store.setConversationPorts(id1, { __PORT_1__: 3000 });
      store.setConversationPorts(id2, { __PORT_1__: 4000, __PORT_2__: 4001 });
      const used = store.getAllUsedPorts();
      expect(used).toEqual(new Set([3000, 4000, 4001]));
    });
  });

  describe("buildIndex on init", () => {
    it("loads pre-written JSON files", () => {
      // Write conversation files directly to disk before creating store
      const convDir = path.join(tmpDir, "conversations");
      fs.mkdirSync(convDir, { recursive: true });
      const id = crypto.randomUUID();
      const conv: Conversation = {
        id,
        name: "Pre-existing",
        slug: "pre-existing",
        projectId: "proj-1",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      fs.writeFileSync(path.join(convDir, `${id}.json`), JSON.stringify(conv));

      const store = createStore(tmpDir);
      expect(store.getConversation(id)?.name).toBe("Pre-existing");
    });

    it("resets stale devServerStatus on init", () => {
      const convDir = path.join(tmpDir, "conversations");
      fs.mkdirSync(convDir, { recursive: true });
      const id = crypto.randomUUID();
      const conv: Conversation = {
        id,
        name: "Stale",
        slug: "stale",
        projectId: "proj-1",
        devServerStatus: "running",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      fs.writeFileSync(path.join(convDir, `${id}.json`), JSON.stringify(conv));

      const store = createStore(tmpDir);
      expect(store.getConversation(id)?.devServerStatus).toBeUndefined();
    });
  });
});
