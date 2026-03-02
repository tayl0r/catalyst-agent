import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Conversation, DevServerStatus, UIMessage } from "@shared/types.js";
import { atomicWrite, isValidId, readJson } from "./utils.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "data");
const MESSAGES_DIR = path.join(DATA_DIR, "messages");
const CONVERSATIONS_DIR = path.join(DATA_DIR, "conversations");

// Concurrency note: All I/O in this module is synchronous (readFileSync,
// writeFileSync, renameSync). Since Node.js is single-threaded, these
// read-modify-write sequences execute atomically with respect to the event
// loop — no interleaving is possible within a single process.

function ensureDirs(): void {
  fs.mkdirSync(MESSAGES_DIR, { recursive: true });
  fs.mkdirSync(CONVERSATIONS_DIR, { recursive: true });
}

function messagesPath(conversationId: string): string {
  if (!isValidId(conversationId)) {
    throw new Error("Invalid conversation ID");
  }
  return path.join(MESSAGES_DIR, `${conversationId}.json`);
}

function conversationPath(id: string): string {
  if (!isValidId(id)) {
    throw new Error("Invalid conversation ID");
  }
  return path.join(CONVERSATIONS_DIR, `${id}.json`);
}

ensureDirs();

// --- In-memory conversation index ---

const conversationIndex = new Map<string, Conversation>();

function buildIndex(): void {
  conversationIndex.clear();
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(CONVERSATIONS_DIR, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const filePath = path.join(CONVERSATIONS_DIR, entry.name);
    const conv = readJson<Conversation | null>(filePath, null);
    if (conv?.id) {
      conversationIndex.set(conv.id, conv);
    }
  }
}

// Build index on startup and reset stale dev server statuses
// (processes don't survive server restarts)
buildIndex();
for (const conv of conversationIndex.values()) {
  if (conv.devServerStatus === "running" || conv.devServerStatus === "starting") {
    conv.devServerStatus = undefined;
    saveConversation(conv);
  }
}

// --- Public API ---

export function loadConversations(): Conversation[] {
  return Array.from(conversationIndex.values());
}

export function getConversation(id: string): Conversation | undefined {
  if (!isValidId(id)) return undefined;
  return conversationIndex.get(id);
}

export function getProjectSlugs(projectId: string): string[] {
  const slugs: string[] = [];
  for (const conv of conversationIndex.values()) {
    if (conv.projectId === projectId) {
      slugs.push(conv.slug);
    }
  }
  return slugs;
}

export function createConversation(
  id: string,
  name: string,
  slug: string,
  projectId: string,
): Conversation {
  if (!isValidId(id)) {
    throw new Error("Invalid conversation ID");
  }
  const now = new Date().toISOString();
  const conversation: Conversation = {
    id,
    name,
    slug,
    projectId,
    created_at: now,
    updated_at: now,
  };
  saveConversation(conversation);
  conversationIndex.set(id, conversation);
  return conversation;
}

function saveConversation(conv: Conversation): void {
  atomicWrite(conversationPath(conv.id), JSON.stringify(conv, null, 2));
}

function patchConversation(id: string, apply: (conv: Conversation) => void): void {
  if (!isValidId(id)) return;
  const conv = conversationIndex.get(id);
  if (!conv) return;
  apply(conv);
  saveConversation(conv);
}

export function touchConversation(id: string): void {
  patchConversation(id, (conv) => {
    conv.updated_at = new Date().toISOString();
  });
}

export function setWorktreeCwd(id: string, cwd: string): void {
  patchConversation(id, (conv) => {
    conv.worktreeCwd = cwd;
  });
}

export function setConversationPorts(id: string, ports: Record<string, number>): void {
  patchConversation(id, (conv) => {
    conv.ports = ports;
  });
}

export function setDevServerStatus(id: string, status: DevServerStatus): void {
  patchConversation(id, (conv) => {
    conv.devServerStatus = status === "stopped" ? undefined : status;
  });
}

export function getAllUsedPorts(): Set<number> {
  const used = new Set<number>();
  for (const conv of conversationIndex.values()) {
    if (conv.ports) {
      for (const port of Object.values(conv.ports)) {
        used.add(port);
      }
    }
  }
  return used;
}

export function archiveConversation(id: string): Conversation | undefined {
  if (!isValidId(id)) return undefined;
  patchConversation(id, (conv) => {
    conv.archived = true;
    conv.worktreeCwd = undefined;
    conv.ports = undefined;
    conv.devServerStatus = undefined;
    conv.updated_at = new Date().toISOString();
  });
  return conversationIndex.get(id);
}

export function deleteConversation(id: string): void {
  if (!isValidId(id)) return;
  conversationIndex.delete(id);
  try {
    fs.unlinkSync(conversationPath(id));
  } catch {
    // file may not exist
  }
  try {
    fs.unlinkSync(messagesPath(id));
  } catch {
    // file may not exist
  }
}

export function loadMessages(conversationId: string): UIMessage[] {
  return readJson<UIMessage[]>(messagesPath(conversationId), []);
}

export function appendMessage(conversationId: string, msg: UIMessage): void {
  const filePath = messagesPath(conversationId);
  const messages = readJson<UIMessage[]>(filePath, []);
  messages.push(msg);
  atomicWrite(filePath, JSON.stringify(messages, null, 2));
}
