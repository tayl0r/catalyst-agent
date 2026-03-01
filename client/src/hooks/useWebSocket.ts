import { useState, useEffect, useRef, useCallback } from "react";
import type { UIMessage, ConnectionStatus, ResultData } from "@shared/types";

const RECONNECT_MIN = 1000;
const RECONNECT_MAX = 30000;

interface UseWebSocketReturn {
  status: ConnectionStatus;
  messages: UIMessage[];
  isProcessing: boolean;
  sendPrompt: (text: string) => void;
  killProcess: () => void;
  clearMessages: () => void;
}

export default function useWebSocket(): UseWebSocketReturn {
  const [status, setStatus] = useState<ConnectionStatus>("disconnected");
  const [messages, setMessages] = useState<UIMessage[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectDelay = useRef(RECONNECT_MIN);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const streamingTextRef = useRef("");
  const mountedRef = useRef(true);

  const getWsUrl = useCallback(() => {
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${proto}//${window.location.host}/ws`;
  }, []);

  const connect = useCallback(() => {
    if (
      wsRef.current?.readyState === WebSocket.OPEN ||
      wsRef.current?.readyState === WebSocket.CONNECTING
    ) return;

    setStatus("connecting");
    const ws = new WebSocket(getWsUrl());
    wsRef.current = ws;

    ws.onopen = () => {
      if (!mountedRef.current) return;
      setStatus("connected");
      reconnectDelay.current = RECONNECT_MIN;
    };

    ws.onmessage = (event: MessageEvent) => {
      if (!mountedRef.current) return;
      let msg: { type: string; data?: unknown };
      try {
        msg = JSON.parse(event.data as string);
      } catch {
        return;
      }

      switch (msg.type) {
        case "text":
          streamingTextRef.current += msg.data as string;
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

        case "assistant":
          // Complete assistant message — replace streaming placeholder
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (last?.type === "assistant" && last.streaming) {
              return [
                ...prev.slice(0, -1),
                { type: "assistant" as const, content: streamingTextRef.current, streaming: false },
              ];
            }
            return [
              ...prev,
              { type: "assistant" as const, content: streamingTextRef.current || JSON.stringify(msg.data), streaming: false },
            ];
          });
          break;

        case "result":
          setMessages((prev) => [
            ...prev,
            { type: "result" as const, data: msg.data as ResultData },
          ]);
          break;

        case "system":
          setMessages((prev) => [
            ...prev,
            { type: "system" as const, data: msg.data as Record<string, unknown> },
          ]);
          break;

        case "stderr":
          // Optionally display stderr
          break;

        case "done":
          setIsProcessing(false);
          streamingTextRef.current = "";
          break;

        case "error":
          setMessages((prev) => [
            ...prev,
            { type: "error" as const, content: msg.data as string },
          ]);
          setIsProcessing(false);
          streamingTextRef.current = "";
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

      streamingTextRef.current = "";
      setIsProcessing(true);
      setMessages((prev) => [
        ...prev,
        { type: "user" as const, content: text },
        { type: "assistant" as const, content: "", streaming: true },
      ]);
      wsRef.current.send(JSON.stringify({ type: "prompt", text }));
    },
    []
  );

  const killProcess = useCallback(() => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify({ type: "kill" }));
  }, []);

  const clearMessages = useCallback(() => {
    if (isProcessingRef.current) {
      // Kill server-side process before clearing
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: "kill" }));
      }
      setIsProcessing(false);
      streamingTextRef.current = "";
    }
    setMessages([]);
  }, []);

  return { status, messages, isProcessing, sendPrompt, killProcess, clearMessages };
}
