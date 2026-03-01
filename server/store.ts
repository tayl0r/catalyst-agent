import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";
import type { Conversation, UIMessage } from "@shared/types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "data");
const MESSAGES_DIR = path.join(DATA_DIR, "messages");
const CONVERSATIONS_FILE = path.join(DATA_DIR, "conversations.json");

// Concurrency note: All I/O in this module is synchronous (readFileSync,
// writeFileSync, renameSync). Since Node.js is single-threaded, these
// read-modify-write sequences execute atomically with respect to the event
// loop — no interleaving is possible within a single process. If this module
// is ever converted to async I/O, a per-file lock must be added.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidConversationId(id: string): boolean {
  return UUID_RE.test(id);
}

function ensureDirs(): void {
  fs.mkdirSync(MESSAGES_DIR, { recursive: true });
}

function atomicWrite(filePath: string, data: string): void {
  const tmp = `${filePath}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(tmp, data, "utf-8");
  fs.renameSync(tmp, filePath);
}

function readJson<T>(filePath: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8")) as T;
  } catch {
    return fallback;
  }
}

function messagesPath(conversationId: string): string {
  if (!isValidConversationId(conversationId)) {
    throw new Error("Invalid conversation ID");
  }
  return path.join(MESSAGES_DIR, `${conversationId}.json`);
}

ensureDirs();

export function loadConversations(): Conversation[] {
  return readJson<Conversation[]>(CONVERSATIONS_FILE, []);
}

export function getConversation(id: string): Conversation | undefined {
  if (!isValidConversationId(id)) return undefined;
  return loadConversations().find((c) => c.id === id);
}

export function createConversation(id: string, title: string): Conversation {
  if (!isValidConversationId(id)) {
    throw new Error("Invalid conversation ID");
  }
  const now = new Date().toISOString();
  const conversation: Conversation = {
    id,
    title,
    created_at: now,
    updated_at: now,
  };
  const conversations = loadConversations();
  conversations.push(conversation);
  atomicWrite(CONVERSATIONS_FILE, JSON.stringify(conversations, null, 2));
  return conversation;
}

export function touchConversation(id: string): void {
  if (!isValidConversationId(id)) return;
  const conversations = loadConversations();
  const conv = conversations.find((c) => c.id === id);
  if (!conv) return;
  conv.updated_at = new Date().toISOString();
  atomicWrite(CONVERSATIONS_FILE, JSON.stringify(conversations, null, 2));
}

export function updateTitle(id: string, title: string): void {
  if (!isValidConversationId(id)) return;
  const conversations = loadConversations();
  const conv = conversations.find((c) => c.id === id);
  if (!conv) return;
  conv.title = title;
  atomicWrite(CONVERSATIONS_FILE, JSON.stringify(conversations, null, 2));
}

export function deleteConversation(id: string): void {
  if (!isValidConversationId(id)) return;
  const conversations = loadConversations().filter((c) => c.id !== id);
  atomicWrite(CONVERSATIONS_FILE, JSON.stringify(conversations, null, 2));
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
