import { useState, useEffect, useRef, useCallback } from "react";
import { isServerMessage } from "@shared/types";
import type {
  UIMessage,
  ConnectionStatus,
  ServerMessage,
  Conversation,
} from "@shared/types";
import { filterEvent } from "../utils/filterEvent";

let nextMessageId = 0;

function createId(): string {
  return String(nextMessageId++);
}

const RECONNECT_MIN = 1000;
const RECONNECT_MAX = 30000;

interface UseWebSocketReturn {
  status: ConnectionStatus;
  messages: UIMessage[];
  isProcessing: boolean;
  currentConversation: Conversation | null;
  conversations: Conversation[];
  sendPrompt: (text: string) => void;
  killProcess: () => void;
  createConversation: (name: string, projectId: string) => void;
  startConversation: (conversationId: string) => void;
  deleteConversation: (conversationId: string) => void;
}

export default function useWebSocket(): UseWebSocketReturn {
  const [status, setStatus] = useState<ConnectionStatus>("disconnected");
  const [messages, setMessages] = useState<UIMessage[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [currentConversation, setCurrentConversation] =
    useState<Conversation | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectDelay = useRef(RECONNECT_MIN);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const streamingTextRef = useRef("");
  const mountedRef = useRef(true);
  // When true, streaming-related messages (text, assistant, error, done, result,
  // system) are discarded. Set on conversation switch to prevent ghost messages
  // from a killed process bleeding into the new conversation's message list.
  const discardStreamRef = useRef(false);
  // Track current conversation for reconnect
  const currentConversationRef = useRef<Conversation | null>(null);

  // Keep ref in sync with state
  useEffect(() => {
    currentConversationRef.current = currentConversation;
  }, [currentConversation]);

  const getWsUrl = useCallback(() => {
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${proto}//${window.location.host}/ws`;
  }, []);

  const wsSend = useCallback((obj: Record<string, unknown>) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(obj));
    }
  }, []);

  const connect = useCallback(() => {
    if (
      wsRef.current?.readyState === WebSocket.OPEN ||
      wsRef.current?.readyState === WebSocket.CONNECTING
    )
      return;

    setStatus("connecting");
    const ws = new WebSocket(getWsUrl());
    wsRef.current = ws;

    ws.onopen = () => {
      if (!mountedRef.current) return;
      setStatus("connected");
      reconnectDelay.current = RECONNECT_MIN;
      // Request conversation list on connect
      ws.send(JSON.stringify({ type: "list_conversations" }));
      // Restore server session state on reconnect
      const conv = currentConversationRef.current;
      if (conv) {
        ws.send(JSON.stringify({ type: "start", conversationId: conv.id }));
      }
    };

    ws.onmessage = (event: MessageEvent) => {
      if (!mountedRef.current) return;
      let msg: ServerMessage;
      try {
        const raw: unknown = JSON.parse(event.data);
        if (!isServerMessage(raw)) return;
        msg = raw;
      } catch {
        return;
      }

      // Streaming-related messages are discarded after a conversation switch
      // to prevent ghost messages from a killed process appearing in the
      // new conversation's message list.
      const discard = discardStreamRef.current;

      switch (msg.type) {
        case "text":
          if (discard) break;
          streamingTextRef.current += msg.data;
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (last?.type === "assistant" && last.streaming) {
              return [
                ...prev.slice(0, -1),
                { ...last, content: streamingTextRef.current },
              ];
            }
            return prev;
          });
          break;

        case "assistant": {
          if (discard) break;
          const filtered = filterEvent(msg.data as Record<string, unknown>);
          if (!filtered) break;
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (last?.type === "assistant" && last.streaming) {
              const existing = last.rawEvents ?? [];
              return [
                ...prev.slice(0, -1),
                {
                  ...last,
                  content: streamingTextRef.current,
                  rawEvents: [...existing, filtered],
                },
              ];
            }
            return [
              ...prev,
              {
                id: createId(),
                type: "assistant" as const,
                content: streamingTextRef.current || JSON.stringify(filtered),
                streaming: true,
                rawEvents: [filtered],
              },
            ];
          });
          break;
        }

        case "result":
          if (discard) break;
          setMessages((prev) => [
            ...prev,
            { id: createId(), type: "result", data: msg.data },
          ]);
          break;

        case "system":
          if (discard) break;
          setMessages((prev) => [
            ...prev,
            { id: createId(), type: "system", data: msg.data },
          ]);
          break;

        case "stderr":
          break;

        case "done":
          if (discard) break;
          setIsProcessing(false);
          streamingTextRef.current = "";
          setMessages((prev) =>
            prev.map((m) =>
              m.type === "assistant" && m.streaming ? { ...m, streaming: false } : m
            )
          );
          break;

        case "error":
          if (discard) break;
          setMessages((prev) => [
            ...prev,
            { id: createId(), type: "error", content: msg.data },
          ]);
          setIsProcessing(false);
          streamingTextRef.current = "";
          break;

        case "conversation":
          setCurrentConversation(msg.conversation);
          break;

        case "conversation_list":
          setConversations(msg.conversations);
          break;

        case "conversation_deleted":
          setConversations((prev) =>
            prev.filter((c) => c.id !== msg.conversationId)
          );
          // If another tab deleted our current conversation, reset
          setCurrentConversation((prev) => {
            if (prev?.id === msg.conversationId) {
              setMessages([]);
              discardStreamRef.current = true;
              return null;
            }
            return prev;
          });
          break;

        case "messages":
          // Receiving replayed messages means we've loaded a conversation
          discardStreamRef.current = false;
          setMessages(msg.messages.map((m) => {
            if (m.type === "assistant" && m.rawEvents) {
              const filtered = m.rawEvents.map(filterEvent).filter((e): e is Record<string, unknown> => e !== null);
              return { ...m, rawEvents: filtered };
            }
            return m;
          }));
          break;

        default:
          break;
      }
    };

    ws.onclose = () => {
      if (!mountedRef.current) return;
      setStatus("disconnected");
      setIsProcessing(false);

      // Auto-reconnect with exponential backoff
      reconnectTimer.current = setTimeout(() => {
        reconnectDelay.current = Math.min(
          reconnectDelay.current * 2,
          RECONNECT_MAX
        );
        connect();
      }, reconnectDelay.current);
    };

    ws.onerror = () => {
      // onclose will fire after onerror
    };
  // Deps: getWsUrl is the only unstable dep. State setters from useState are
  // stable. Refs (streamingTextRef, discardStreamRef, etc.) are mutable objects
  // and intentionally not listed — their .current is read at call time.
  }, [getWsUrl]);

  useEffect(() => {
    mountedRef.current = true;
    connect();
    return () => {
      mountedRef.current = false;
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
    };
  }, [connect]);

  const isProcessingRef = useRef(false);

  // Keep ref in sync with state
  useEffect(() => {
    isProcessingRef.current = isProcessing;
  }, [isProcessing]);

  const sendPrompt = useCallback(
    (text: string) => {
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
      if (isProcessingRef.current) return;

      discardStreamRef.current = false;
      streamingTextRef.current = "";
      setIsProcessing(true);
      setMessages((prev) => [
        ...prev,
        { id: createId(), type: "user", content: text },
        { id: createId(), type: "assistant", content: "", streaming: true },
      ]);
      wsRef.current.send(JSON.stringify({ type: "prompt", text }));
    },
    []
  );

  const killProcess = useCallback(() => {
    wsSend({ type: "kill" });
    setIsProcessing(false);
    streamingTextRef.current = "";
    setMessages((prev) =>
      prev.map((m) =>
        m.type === "assistant" && m.streaming ? { ...m, streaming: false } : m
      )
    );
  }, [wsSend]);

  const createConversation = useCallback(
    (name: string, projectId: string) => {
      discardStreamRef.current = true;
      wsSend({ type: "kill" });
      setIsProcessing(false);
      streamingTextRef.current = "";
      setMessages([]);
      setCurrentConversation(null);
      wsSend({ type: "create_conversation", name, projectId });
    },
    [wsSend]
  );

  const startConversation = useCallback(
    (conversationId: string) => {
      discardStreamRef.current = true;
      wsSend({ type: "kill" });
      setIsProcessing(false);
      streamingTextRef.current = "";
      setMessages([]);
      wsSend({ type: "start", conversationId });
    },
    [wsSend]
  );

  const deleteConversation = useCallback(
    (conversationId: string) => {
      wsSend({ type: "delete_conversation", conversationId });
      // If deleting current conversation, reset and discard in-flight streams
      setCurrentConversation((prev) => {
        if (prev?.id === conversationId) {
          discardStreamRef.current = true;
          setMessages([]);
          return null;
        }
        return prev;
      });
    },
    [wsSend]
  );

  return {
    status,
    messages,
    isProcessing,
    currentConversation,
    conversations,
    sendPrompt,
    killProcess,
    createConversation,
    startConversation,
    deleteConversation,
  };
}
