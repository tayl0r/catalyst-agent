import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import ChatMessage from "../components/ChatMessage";
import InputArea from "../components/InputArea";
import NewConversationModal from "../components/NewConversationModal";
import ServerPanel from "../components/ServerPanel";
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
    serverStatus,
    serverLogs,
    serverPorts,
    sendPrompt,
    killProcess,
    createConversation,
    startConversation,
    deleteConversation,
    startServer,
    stopServer,
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
  const [showServerPanel, setShowServerPanel] = useState(false);
  const [initialProjectId, setInitialProjectId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const scrollContainerRef = useRef<HTMLElement | null>(null);
  const isNearBottomRef = useRef(true);

  const handleScroll = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    isNearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }, []);

  useEffect(() => {
    if (!isNearBottomRef.current) return;
    const el = scrollContainerRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages]);

  // Reset scroll-to-bottom on conversation switch
  useEffect(() => {
    isNearBottomRef.current = true;
  }, [currentConversation?.id]);

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
          <div className="flex items-center gap-2">
            {serverPorts && (
              <>
                {serverStatus === "stopped" ? (
                  <button
                    type="button"
                    onClick={startServer}
                    className="flex items-center gap-1 rounded px-2 py-1 text-xs text-green-400 hover:bg-gray-800 transition-colors"
                    title="Start dev server"
                  >
                    <svg
                      className="h-3.5 w-3.5"
                      fill="currentColor"
                      viewBox="0 0 24 24"
                      aria-hidden="true"
                    >
                      <path d="M8 5v14l11-7z" />
                    </svg>
                    Start
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={stopServer}
                    disabled={serverStatus === "stopping"}
                    className="flex items-center gap-1 rounded px-2 py-1 text-xs text-red-400 hover:bg-gray-800 transition-colors disabled:opacity-50"
                    title="Stop dev server"
                  >
                    <svg
                      className="h-3.5 w-3.5"
                      fill="currentColor"
                      viewBox="0 0 24 24"
                      aria-hidden="true"
                    >
                      <rect x="6" y="6" width="12" height="12" />
                    </svg>
                    Stop
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setShowServerPanel((v) => !v)}
                  className={`rounded px-2 py-1 text-xs transition-colors ${
                    showServerPanel
                      ? "bg-gray-800 text-gray-200"
                      : "text-gray-400 hover:bg-gray-800 hover:text-gray-300"
                  }`}
                  title="Toggle server logs"
                >
                  Logs
                </button>
              </>
            )}
            <StatusIndicator status={status} />
          </div>
        </header>

        <div className="flex flex-1 overflow-hidden">
          <div className="flex flex-1 flex-col min-w-0">
            {/* Messages */}
            <main
              ref={scrollContainerRef}
              onScroll={handleScroll}
              className="flex-1 overflow-y-auto px-4 py-6"
            >
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

          {showServerPanel && (
            <ServerPanel
              logs={serverLogs}
              status={serverStatus}
              ports={serverPorts}
              onClose={() => setShowServerPanel(false)}
            />
          )}
        </div>
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
