import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import ChatMessage from "../components/ChatMessage";
import InputArea from "../components/InputArea";
import NewConversationModal from "../components/NewConversationModal";
import Sidebar from "../components/Sidebar";
import StatusIndicator from "../components/StatusIndicator";
import useProjects from "../hooks/useProjects";
import useWebSocket from "../hooks/useWebSocket";

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
  const currentProject = useMemo(
    () => projects.find((p) => p.id === currentConversation?.projectId),
    [projects, currentConversation?.projectId],
  );
  const location = useLocation();
  const navigate = useNavigate();
  const [filterProjectId, setFilterProjectId] = useState<string | null>(null);
  const [showNewModal, setShowNewModal] = useState(false);
  const [initialProjectId, setInitialProjectId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Open modal with pre-selected project when navigated from ProjectsPage
  useEffect(() => {
    const state = location.state as { newConversationProjectId?: string } | null;
    if (state?.newConversationProjectId) {
      setInitialProjectId(state.newConversationProjectId);
      setShowNewModal(true);
      // Clear the state so refreshing doesn't re-open the modal
      navigate("/", { replace: true, state: {} });
    }
  }, [location.state, navigate]);

  const handleNew = () => {
    setInitialProjectId(null);
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
              <div className="flex items-center gap-2 text-xs text-gray-500 truncate">
                {currentProject && (
                  <span className="flex items-center gap-1 shrink-0">
                    <span
                      className="inline-block h-2 w-2 rounded-full"
                      style={{ backgroundColor: currentProject.color }}
                    />
                    <span>{currentProject.name}</span>
                  </span>
                )}
                {currentProject && currentConversation.slug && (
                  <span className="text-gray-700">/</span>
                )}
                {currentConversation.slug && (
                  <button
                    type="button"
                    className="text-gray-400 hover:text-gray-300 truncate transition-colors"
                    title="Click to copy branch name"
                    onClick={() => navigator.clipboard.writeText(currentConversation.slug)}
                  >
                    {currentConversation.slug}
                  </button>
                )}
              </div>
            )}
          </div>
          <StatusIndicator status={status} />
        </header>

        {/* Messages */}
        <main className="flex-1 overflow-y-auto px-4 py-6">
          <div className="mx-auto max-w-5xl space-y-4">
            {messages.length === 0 && (
              <div className="flex h-full items-center justify-center pt-32">
                <p className="text-gray-600 text-sm">
                  Create a conversation to start chatting with Claude.
                </p>
              </div>
            )}
            {messages.map((msg) => (
              <ChatMessage key={msg.id} message={msg} onSend={sendPrompt} />
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
        initialProjectId={initialProjectId}
      />
    </div>
  );
}
