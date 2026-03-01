import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import type { Conversation, UIMessage } from "@shared/types.js";
import { isValidId, atomicWrite, readJson } from "./utils.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "data");
const MESSAGES_DIR = path.join(DATA_DIR, "messages");
const CONVERSATIONS_DIR = path.join(DATA_DIR, "conversations");

// Concurrency note: All I/O in this module is synchronous (readFileSync,
// writeFileSync, renameSync). Since Node.js is single-threaded, these
// read-modify-write sequences execute atomically with respect to the event
// loop — no interleaving is possible within a single process.

export function isValidConversationId(id: string): boolean {
  return isValidId(id);
}

function ensureDirs(): void {
  fs.mkdirSync(MESSAGES_DIR, { recursive: true });
  fs.mkdirSync(CONVERSATIONS_DIR, { recursive: true });
}

function messagesPath(conversationId: string): string {
  if (!isValidConversationId(conversationId)) {
    throw new Error("Invalid conversation ID");
  }
  return path.join(MESSAGES_DIR, `${conversationId}.json`);
}

function conversationPath(id: string): string {
  if (!isValidConversationId(id)) {
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
    if (conv && conv.id) {
      conversationIndex.set(conv.id, conv);
    }
  }
}

// Build index on startup
buildIndex();

// --- Public API ---

export function loadConversations(): Conversation[] {
  return Array.from(conversationIndex.values());
}

export function getConversation(id: string): Conversation | undefined {
  if (!isValidConversationId(id)) return undefined;
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

export function createConversation(id: string, name: string, slug: string, projectId: string): Conversation {
  if (!isValidConversationId(id)) {
    throw new Error("Invalid conversation ID");
  }
  const now = new Date().toISOString();
  const conversation: Conversation = {
    id,
    name,
    slug,
    title: name,
    projectId,
    created_at: now,
    updated_at: now,
  };
  atomicWrite(conversationPath(id), JSON.stringify(conversation, null, 2));
  conversationIndex.set(id, conversation);
  return conversation;
}

export function touchConversation(id: string): void {
  if (!isValidConversationId(id)) return;
  const conv = conversationIndex.get(id);
  if (!conv) return;
  conv.updated_at = new Date().toISOString();
  atomicWrite(conversationPath(id), JSON.stringify(conv, null, 2));
}

export function setWorktreeCwd(id: string, cwd: string): void {
  if (!isValidConversationId(id)) return;
  const conv = conversationIndex.get(id);
  if (!conv) return;
  conv.worktreeCwd = cwd;
  atomicWrite(conversationPath(id), JSON.stringify(conv, null, 2));
}

export function deleteConversation(id: string): void {
  if (!isValidConversationId(id)) return;
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
