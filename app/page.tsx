"use client";

import { useEffect, useRef } from "react";
import { useRegistry, useChat } from "@/lib/hub-state";
import ProjectList from "@/app/components/ProjectList";
import ChatPlayground from "@/app/components/ChatPlayground";
import { Terminal } from "lucide-react";

export default function HubConsole() {
  const {
    folders,
    activeFolder,
    setActiveFolder,
    loading,
    fetchFolders,
    warmUp,
    clearSession,
    unregister,
  } = useRegistry();

  const {
    messages,
    sending,
    sendMessage,
    clearMessages,
    addSystemMessage,
    thinkingState,
    activeModel,
  } = useChat();

  const hasInitialized = useRef(false);

  // Initial fetch (Strict Mode guard: run once per lifecycle)
  useEffect(() => {
    if (!hasInitialized.current) {
      hasInitialized.current = true;
      fetchFolders();
    }
  }, [fetchFolders]);

  return (
    <div className="flex h-screen flex-col">
      {/* Top bar */}
      <header className="flex items-center gap-3 border-b border-border bg-surface-1 px-4 py-2">
        <Terminal size={16} className="text-accent" />
        <h1 className="font-mono text-sm font-semibold tracking-wider text-text-primary">
          GEMINI LOCAL
        </h1>
        <span className="font-mono text-[10px] text-text-muted">
          Hub Console
        </span>
        <div className="flex-1" />
        <span className="font-mono text-[10px] text-text-muted">
          v1.0.0
        </span>
      </header>

      {/* Split pane */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left sidebar — 1/4 width */}
        <div className="w-1/4 min-w-[260px] max-w-[360px]">
          <ProjectList
            folders={folders}
            activeFolder={activeFolder}
            loading={loading}
            onSelect={setActiveFolder}
            onRefresh={fetchFolders}
            onWarmUp={warmUp}
            onClearSession={clearSession}
            onUnregister={unregister}
          />
        </div>

        {/* Right main — 3/4 width */}
        <div className="flex-1">
          <ChatPlayground
            folders={folders}
            activeFolder={activeFolder}
            onSelectFolder={setActiveFolder}
            messages={messages}
            sending={sending}
            onSendMessage={sendMessage}
            onClearMessages={clearMessages}
            onAddSystemMessage={addSystemMessage}
            thinkingState={thinkingState}
            activeModel={activeModel}
          />
        </div>
      </div>
    </div>
  );
}
