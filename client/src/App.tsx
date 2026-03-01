import { useEffect, useRef } from "react";
import useWebSocket from "./hooks/useWebSocket";
import StatusIndicator from "./components/StatusIndicator";
import ChatMessage from "./components/ChatMessage";
import InputArea from "./components/InputArea";

export default function App() {
  const { status, messages, isProcessing, sendPrompt, killProcess, clearMessages } =
    useWebSocket();
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  return (
    <div className="flex h-screen flex-col bg-gray-950 font-mono">
      {/* Header */}
      <header className="flex items-center justify-between border-b border-gray-800 px-4 py-3">
        <h1 className="text-lg font-semibold text-gray-100">cc-web</h1>
        <div className="flex items-center gap-4">
          <button
            onClick={clearMessages}
            className="text-sm text-gray-500 hover:text-gray-300 transition-colors"
          >
            Clear
          </button>
          <StatusIndicator status={status} />
        </div>
      </header>

      {/* Messages */}
      <main className="flex-1 overflow-y-auto px-4 py-6">
        <div className="mx-auto max-w-3xl space-y-4">
          {messages.length === 0 && (
            <div className="flex h-full items-center justify-center pt-32">
              <p className="text-gray-600 text-sm">
                Send a message to start a conversation with Claude.
              </p>
            </div>
          )}
          {messages.map((msg, i) => (
            <ChatMessage key={i} message={msg} />
          ))}
          <div ref={messagesEndRef} />
        </div>
      </main>

      {/* Input */}
      <InputArea
        onSend={sendPrompt}
        onStop={killProcess}
        isProcessing={isProcessing}
        disabled={status !== "connected"}
      />
    </div>
  );
}
