import { useState, useEffect, useRef, useCallback } from "react";

const RECONNECT_MIN = 1000;
const RECONNECT_MAX = 30000;

export default function useWebSocket() {
  const [status, setStatus] = useState("disconnected");
  const [messages, setMessages] = useState([]);
  const [isProcessing, setIsProcessing] = useState(false);

  const wsRef = useRef(null);
  const reconnectDelay = useRef(RECONNECT_MIN);
  const reconnectTimer = useRef(null);
  const streamingTextRef = useRef("");
  const mountedRef = useRef(true);

  const getWsUrl = useCallback(() => {
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${proto}//${window.location.host}/ws`;
  }, []);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const ws = new WebSocket(getWsUrl());
    wsRef.current = ws;

    ws.onopen = () => {
      if (!mountedRef.current) return;
      setStatus("connected");
      reconnectDelay.current = RECONNECT_MIN;
    };

    ws.onmessage = (event) => {
      if (!mountedRef.current) return;
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }

      switch (msg.type) {
        case "text":
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

        case "assistant":
          // Complete assistant message — replace streaming placeholder
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (last?.type === "assistant" && last.streaming) {
              return [
                ...prev.slice(0, -1),
                { type: "assistant", content: streamingTextRef.current, streaming: false },
              ];
            }
            return [
              ...prev,
              { type: "assistant", content: streamingTextRef.current || JSON.stringify(msg.data), streaming: false },
            ];
          });
          break;

        case "result":
          setMessages((prev) => [
            ...prev,
            { type: "result", data: msg.data },
          ]);
          break;

        case "system":
          setMessages((prev) => [
            ...prev,
            { type: "system", data: msg.data },
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
            { type: "error", content: msg.data },
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
      clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
    };
  }, [connect]);

  const sendPrompt = useCallback(
    (text) => {
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
      if (isProcessing) return;

      streamingTextRef.current = "";
      setIsProcessing(true);
      setMessages((prev) => [
        ...prev,
        { type: "user", content: text },
        { type: "assistant", content: "", streaming: true },
      ]);
      wsRef.current.send(JSON.stringify({ type: "prompt", text }));
    },
    [isProcessing]
  );

  const killProcess = useCallback(() => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify({ type: "kill" }));
  }, []);

  const clearMessages = useCallback(() => {
    setMessages([]);
  }, []);

  return { status, messages, isProcessing, sendPrompt, killProcess, clearMessages };
}
