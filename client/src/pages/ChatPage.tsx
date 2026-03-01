import { useEffect, useRef, useState } from "react";
import useWebSocket from "../hooks/useWebSocket";
import useProjects from "../hooks/useProjects";
import StatusIndicator from "../components/StatusIndicator";
import ChatMessage from "../components/ChatMessage";
import InputArea from "../components/InputArea";
import Sidebar from "../components/Sidebar";
import NewConversationModal from "../components/NewConversationModal";

export default function ChatPage() {
  const {
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
  } = useWebSocket();

  const { projects } = useProjects();
  const [filterProjectId, setFilterProjectId] = useState<string | null>(null);
  const [showNewModal, setShowNewModal] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleNew = () => {
    setShowNewModal(true);
  };

  const handleModalSubmit = (name: string, projectId: string) => {
    createConversation(name, projectId);
    setShowNewModal(false);
  };

  return (
    <div className="flex h-screen bg-gray-950 font-mono">
      <Sidebar
        conversations={conversations}
        currentId={currentConversation?.id ?? null}
        onSelect={(id) => startConversation(id)}
        onNew={handleNew}
        onDelete={(id) => deleteConversation(id)}
        projects={projects}
        filterProjectId={filterProjectId}
        onFilterProject={setFilterProjectId}
      />

      <div className="flex flex-1 flex-col">
        {/* Header */}
        <header className="flex items-center justify-between border-b border-gray-800 px-4 py-3">
          <div className="min-w-0 flex-1">
            <h1 className="text-lg font-semibold text-gray-100 truncate">
              {currentConversation?.name ?? "New conversation"}
            </h1>
            {currentConversation && (
              <button
                className="text-xs text-gray-600 hover:text-gray-400 truncate max-w-full text-left transition-colors"
                title="Click to copy session ID"
                onClick={() => navigator.clipboard.writeText(currentConversation.id)}
              >
                {currentConversation.id}
              </button>
            )}
          </div>
          <StatusIndicator status={status} />
        </header>

        {/* Messages */}
        <main className="flex-1 overflow-y-auto px-4 py-6">
          <div className="mx-auto max-w-3xl space-y-4">
            {messages.length === 0 && (
              <div className="flex h-full items-center justify-center pt-32">
                <p className="text-gray-600 text-sm">
                  Create a conversation to start chatting with Claude.
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
          disabled={status !== "connected" || !currentConversation}
        />
      </div>

      <NewConversationModal
        isOpen={showNewModal}
        onClose={() => setShowNewModal(false)}
        onSubmit={handleModalSubmit}
        projects={projects}
      />
    </div>
  );
}
