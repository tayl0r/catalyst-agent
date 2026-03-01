// --- Client-to-server messages ---

export interface PromptMessage {
  type: "prompt";
  text: string;
}

export interface KillMessage {
  type: "kill";
}

export type ClientMessage = PromptMessage | KillMessage;

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

export type ServerMessage =
  | TextMessage
  | AssistantMessage
  | ResultMessage
  | SystemMessage
  | ErrorMessage
  | StderrMessage
  | DoneMessage;

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
  return false;
}

const SERVER_MESSAGE_TYPES: ReadonlySet<string> = new Set([
  "text", "assistant", "result", "system", "error", "stderr", "done",
]);

export function isServerMessage(msg: unknown): msg is ServerMessage {
  if (typeof msg !== "object" || msg === null) return false;
  const obj = msg as Record<string, unknown>;
  return typeof obj.type === "string" && SERVER_MESSAGE_TYPES.has(obj.type);
}
