import { useEffect, useRef } from "react";
import useWebSocket from "./hooks/useWebSocket";
import StatusIndicator from "./components/StatusIndicator";
import ChatMessage from "./components/ChatMessage";
import InputArea from "./components/InputArea";
import Sidebar from "./components/Sidebar";

export default function App() {
  const {
    status,
    messages,
    isProcessing,
    currentConversation,
    conversations,
    sendPrompt,
    killProcess,
    startConversation,
    deleteConversation,
  } = useWebSocket();
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  return (
    <div className="flex h-screen bg-gray-950 font-mono">
      <Sidebar
        conversations={conversations}
        currentId={currentConversation?.id ?? null}
        onSelect={(id) => startConversation(id)}
        onNew={() => startConversation()}
        onDelete={(id) => deleteConversation(id)}
      />

      <div className="flex flex-1 flex-col">
        {/* Header */}
        <header className="flex items-center justify-between border-b border-gray-800 px-4 py-3">
          <h1 className="text-lg font-semibold text-gray-100 truncate">
            {currentConversation?.title ?? "New conversation"}
          </h1>
          <StatusIndicator status={status} />
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
            {messages.map((msg) => (
              <ChatMessage key={msg.id} message={msg} />
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
    </div>
  );
}
