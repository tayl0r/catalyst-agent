// --- Conversation metadata ---

export interface Conversation {
  id: string;
  name: string;
  slug: string;
  projectId: string;
  worktreeCwd?: string; // cwd reported by Claude CLI init event (worktree path)
  ports?: Record<string, number>; // allocated port numbers (e.g. { __PORT_1__: 3247 })
  devServerStatus?: DevServerStatus; // persisted dev server state
  created_at: string;
  updated_at: string;
}

export type DevServerStatus = "stopped" | "starting" | "running" | "stopping";

export function slugify(input: string): string {
  return (
    input
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "conversation"
  );
}

export interface Project {
  id: string;
  name: string;
  path: string;
  description?: string;
  color: string; // hex color e.g. "#3b82f6"
}

export const PROJECT_COLORS = [
  "#3b82f6", // blue
  "#10b981", // emerald
  "#f59e0b", // amber
  "#ef4444", // red
  "#8b5cf6", // violet
  "#ec4899", // pink
  "#06b6d4", // cyan
  "#f97316", // orange
  "#84cc16", // lime
  "#6366f1", // indigo
] as const;

// --- Client-to-server messages ---

export interface PromptMessage {
  type: "prompt";
  text: string;
}

export interface KillMessage {
  type: "kill";
}

export interface CreateConversationMessage {
  type: "create_conversation";
  name: string;
  projectId: string;
}

export interface StartMessage {
  type: "start";
  conversationId: string;
}

export interface ListConversationsMessage {
  type: "list_conversations";
}

export interface DeleteConversationMessage {
  type: "delete_conversation";
  conversationId: string;
}

export interface StartServerMessage {
  type: "start_server";
}

export interface StopServerMessage {
  type: "stop_server";
}

export type ClientMessage =
  | PromptMessage
  | KillMessage
  | CreateConversationMessage
  | StartMessage
  | ListConversationsMessage
  | DeleteConversationMessage
  | StartServerMessage
  | StopServerMessage;

// --- Server-to-client messages ---

export interface TextMessage {
  type: "text";
  data: string;
}

export interface AssistantMessage {
  type: "assistant";
  data: Record<string, unknown>;
}

export interface ResultData {
  cost_usd?: number;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
  [key: string]: unknown;
}

export interface ResultMessage {
  type: "result";
  data: ResultData;
}

export interface SystemMessage {
  type: "system";
  data: Record<string, unknown>;
}

export interface ErrorMessage {
  type: "error";
  data: string;
}

export interface StderrMessage {
  type: "stderr";
  data: string;
}

export interface DoneMessage {
  type: "done";
  exitCode: number | null;
}

export interface ConversationMessage {
  type: "conversation";
  conversation: Conversation | null;
}

export interface ConversationListMessage {
  type: "conversation_list";
  conversations: Conversation[];
}

export interface ConversationDeletedMessage {
  type: "conversation_deleted";
  conversationId: string;
}

export interface MessagesMessage {
  type: "messages";
  messages: UIMessage[];
}

export interface ServerOutputMessage {
  type: "server_output";
  conversationId: string;
  data: string;
  stream: "stdout" | "stderr";
}

export interface ServerStatusMessage {
  type: "server_status";
  conversationId: string;
  status: DevServerStatus;
  ports?: Record<string, number>;
}

export type ServerMessage =
  | TextMessage
  | AssistantMessage
  | ResultMessage
  | SystemMessage
  | ErrorMessage
  | StderrMessage
  | DoneMessage
  | ConversationMessage
  | ConversationListMessage
  | ConversationDeletedMessage
  | MessagesMessage
  | ServerOutputMessage
  | ServerStatusMessage;

// --- Client-side UI message types (different from wire types) ---

interface BaseUIMessage {
  id: string;
}

export interface UserUIMessage extends BaseUIMessage {
  type: "user";
  content: string;
}

export interface AssistantUIMessage extends BaseUIMessage {
  type: "assistant";
  content: string;
  streaming: boolean;
  rawEvents?: Record<string, unknown>[];
}

export interface ErrorUIMessage extends BaseUIMessage {
  type: "error";
  content: string;
}

export interface ResultUIMessage extends BaseUIMessage {
  type: "result";
  data: ResultData;
}

export interface SystemUIMessage extends BaseUIMessage {
  type: "system";
  data: Record<string, unknown>;
}

export type UIMessage =
  | UserUIMessage
  | AssistantUIMessage
  | ErrorUIMessage
  | ResultUIMessage
  | SystemUIMessage;

// --- Connection status ---

export type ConnectionStatus = "disconnected" | "connecting" | "connected";

// --- Runtime type guards ---

export function isClientMessage(msg: unknown): msg is ClientMessage {
  if (typeof msg !== "object" || msg === null) return false;
  const obj = msg as Record<string, unknown>;
  if (obj.type === "kill") return true;
  if (obj.type === "prompt" && typeof obj.text === "string") return true;
  if (
    obj.type === "create_conversation" &&
    typeof obj.name === "string" &&
    typeof obj.projectId === "string"
  )
    return true;
  if (obj.type === "start" && typeof obj.conversationId === "string") return true;
  if (obj.type === "list_conversations") return true;
  if (obj.type === "delete_conversation" && typeof obj.conversationId === "string") return true;
  if (obj.type === "start_server") return true;
  if (obj.type === "stop_server") return true;
  return false;
}

const SERVER_MESSAGE_TYPES: ReadonlySet<string> = new Set([
  "text",
  "assistant",
  "result",
  "system",
  "error",
  "stderr",
  "done",
  "conversation",
  "conversation_list",
  "conversation_deleted",
  "messages",
  "server_output",
  "server_status",
]);

export function isServerMessage(msg: unknown): msg is ServerMessage {
  if (typeof msg !== "object" || msg === null) return false;
  const obj = msg as Record<string, unknown>;
  return typeof obj.type === "string" && SERVER_MESSAGE_TYPES.has(obj.type);
}
