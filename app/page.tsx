"use client";

import { useEffect, useRef } from "react";
import { useRegistry, useChat } from "@/lib/hub-state";
import ProjectList from "@/app/components/ProjectList";
import ChatPlayground from "@/app/components/ChatPlayground";
import { Terminal, Zap } from "lucide-react";
import { clsx } from "clsx";

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
    pendingToolCall,
    onApproveToolCall,
    onRejectToolCall,
    yoloMode,
    setYoloMode,
    fetchChatConfig,
  } = useChat();

  const hasInitialized = useRef(false);

  // Initial fetch (Strict Mode guard: run once per lifecycle)
  useEffect(() => {
    if (!hasInitialized.current) {
      hasInitialized.current = true;
      fetchFolders();
    }
  }, [fetchFolders]);

  // Sync YOLO mode from backend when active folder changes
  useEffect(() => {
    if (activeFolder) fetchChatConfig(activeFolder);
  }, [activeFolder, fetchChatConfig]);

  const handleYoloToggle = () => {
    if (!activeFolder) return;
    setYoloMode(activeFolder, !yoloMode);
  };

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
        <button
          type="button"
          onClick={handleYoloToggle}
          disabled={!activeFolder}
          title={activeFolder ? (yoloMode ? "YOLO mode: on (tools auto-run)" : "YOLO mode: off (approve tools)") : "Select a project to toggle"}
          className={clsx(
            "flex items-center gap-1.5 rounded px-2 py-1 font-mono text-[11px] transition-colors",
            yoloMode
              ? "bg-amber-500/20 text-amber-600 dark:text-amber-400"
              : "text-text-muted hover:bg-surface-2 hover:text-text-secondary",
            !activeFolder && "cursor-not-allowed opacity-50",
          )}
        >
          <Zap size={12} />
          YOLO
        </button>
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
            pendingToolCall={pendingToolCall}
            onApproveToolCall={onApproveToolCall}
            onRejectToolCall={onRejectToolCall}
          />
        </div>
      </div>
    </div>
  );
}
