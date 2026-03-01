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

export interface UserUIMessage {
  type: "user";
  content: string;
}

export interface AssistantUIMessage {
  type: "assistant";
  content: string;
  streaming: boolean;
}

export interface ErrorUIMessage {
  type: "error";
  content: string;
}

export interface ResultUIMessage {
  type: "result";
  data: ResultData;
}

export interface SystemUIMessage {
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
