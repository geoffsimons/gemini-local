"use client";

import { useState, useCallback, useRef } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FolderStatus = "ready" | "cold" | "initializing";

export interface FolderEntry {
  path: string;
  status: FolderStatus;
}

export interface RegistryListResponse {
  folders: Array<{ path: string; isReady: boolean }>;
}

/** Tool call awaiting user approval (matches stream TOOL_USE event). */
export interface PendingToolCall {
  type: "TOOL_USE";
  tool_name: string;
  parameters: Record<string, unknown>;
  tool_id?: string;
}

// ---------------------------------------------------------------------------
// Hook: useRegistry — Manages the folder list + active selection
// ---------------------------------------------------------------------------

export function useRegistry() {
  const [folders, setFolders] = useState<FolderEntry[]>([]);
  const [activeFolder, setActiveFolder] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchFolders = useCallback(async () => {
    try {
      const res = await fetch("/api/registry/list");
      if (!res.ok) throw new Error("Failed to fetch registry");
      const data: RegistryListResponse = await res.json();
      const entries: FolderEntry[] = data.folders.map((f) => ({
        path: f.path,
        status: f.isReady ? "ready" : "cold",
      }));
      setFolders(entries);
      // Auto-select first folder if nothing is active
      if (!activeFolder && entries.length > 0) {
        setActiveFolder(entries[0].path);
      }
    } catch {
      // Silently fail — the UI will show an empty state
    } finally {
      setLoading(false);
    }
  }, [activeFolder]);

  // Optimistic status update for snappy feel
  const setFolderStatus = useCallback(
    (folderPath: string, status: FolderStatus) => {
      setFolders((prev) =>
        prev.map((f) => (f.path === folderPath ? { ...f, status } : f)),
      );
    },
    [],
  );

  const warmUp = useCallback(
    async (folderPath: string) => {
      setFolderStatus(folderPath, "initializing");
      try {
        const res = await fetch("/api/chat/start", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ folderPath }),
        });
        if (!res.ok) throw new Error("Warm-up failed");
        setFolderStatus(folderPath, "ready");
      } catch {
        setFolderStatus(folderPath, "cold");
      }
    },
    [setFolderStatus],
  );

  const clearSession = useCallback(
    async (folderPath: string) => {
      try {
        await fetch("/api/chat/clear", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ folderPath }),
        });
        setFolderStatus(folderPath, "cold");
      } catch {
        // no-op
      }
    },
    [setFolderStatus],
  );

  const unregister = useCallback(
    async (folderPath: string) => {
      try {
        await fetch("/api/registry/unregister", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ folderPath }),
        });
        setFolders((prev) => prev.filter((f) => f.path !== folderPath));
        if (activeFolder === folderPath) {
          setActiveFolder(null);
        }
      } catch {
        // no-op
      }
    },
    [activeFolder],
  );

  return {
    folders,
    activeFolder,
    setActiveFolder,
    loading,
    fetchFolders,
    warmUp,
    clearSession,
    unregister,
    setFolderStatus,
  };
}

// ---------------------------------------------------------------------------
// Hook: useChat — Manages chat messages for the playground
// ---------------------------------------------------------------------------

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  thought?: string;
  images?: string[]; // base64 data URIs for user-attached previews
  timestamp: number;
}

export function useChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sending, setSending] = useState(false);
  const [thinkingState, setThinkingState] = useState<string | null>(null);
  const [activeModel, setActiveModel] = useState<string | null>(null);
  const [pendingToolCall, setPendingToolCall] = useState<PendingToolCall | null>(null);
  const [yoloMode, setYoloModeState] = useState(false);
  const idCounter = useRef(0);

  const sendMessage = useCallback(
    async (
      folderPath: string,
      text: string,
      images?: Array<{ data: string; mimeType: string }>,
    ) => {
      const userMsg: ChatMessage = {
        id: `msg-${++idCounter.current}`,
        role: "user",
        text,
        images: images?.map(
          (img) => `data:${img.mimeType};base64,${img.data}`,
        ),
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, userMsg]);
      setSending(true);
      setThinkingState(null);
      setPendingToolCall(null);

      try {
        const res = await fetch("/api/chat/prompt", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            folderPath,
            message: text || undefined,
            images: images?.length ? images : undefined,
            stream: true,
          }),
        });

        if (!res.ok) {
          const errorData = await res.json().catch(() => ({}));
          throw new Error(errorData.error || "Failed to fetch");
        }

        if (!res.body) throw new Error("No response body");

        const assistantId = `msg-${++idCounter.current}`;
        const assistantMsg: ChatMessage = {
          id: assistantId,
          role: "assistant",
          text: "",
          timestamp: Date.now(),
        };
        setMessages((prev) => [...prev, assistantMsg]);

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            try {
              const event = JSON.parse(trimmed) as {
                type: string;
                model?: string;
                tool_name?: string;
                tool_id?: string;
                parameters?: Record<string, unknown>;
                content?: string;
                delta?: boolean;
                message?: string;
              };

              switch (event.type) {
                case "INIT":
                  if (event.model) setActiveModel(event.model);
                  break;
                case "TOOL_USE": {
                  setPendingToolCall({
                    type: "TOOL_USE",
                    tool_name: event.tool_name ?? "tool",
                    parameters: event.parameters ?? {},
                    ...(event.tool_id && { tool_id: event.tool_id }),
                  });
                  const params = event.parameters ?? {};
                  const pathVal = typeof params.path === "string" ? params.path : undefined;
                  const label = pathVal ? `Reading ${pathVal}` : `Using ${event.tool_name ?? "tool"}`;
                  setThinkingState(label);
                  break;
                }
                case "MESSAGE":
                  setThinkingState(null);
                  if (event.delta) {
                    setMessages((prev) =>
                      prev.map((m) =>
                        m.id === assistantId
                          ? { ...m, text: m.text + (event.content ?? "") }
                          : m,
                      ),
                    );
                  } else if (event.content !== undefined) {
                    setMessages((prev) =>
                      prev.map((m) =>
                        m.id === assistantId ? { ...m, text: event.content ?? "" } : m,
                      ),
                    );
                  }
                  break;
                case "RESULT":
                case "ERROR":
                  setThinkingState(null);
                  if (event.type === "ERROR" && event.message) {
                    setMessages((prev) =>
                      prev.map((m) =>
                        m.id === assistantId
                          ? { ...m, text: m.text + `\n\n[Error: ${event.message}]` }
                          : m,
                      ),
                    );
                  }
                  break;
              }
            } catch (err) {
              console.error("Failed to parse NDJSON event", err);
            }
          }
        }
      } catch (err: any) {
        setThinkingState(null);
        const errorMsg: ChatMessage = {
          id: `msg-${++idCounter.current}`,
          role: "assistant",
          text: `Error: ${err.message || "Failed to reach the server."}`,
          timestamp: Date.now(),
        };
        setMessages((prev) => [...prev, errorMsg]);
      } finally {
        setSending(false);
      }
    },
    [],
  );

  const clearMessages = useCallback(() => {
    setMessages([]);
  }, []);

  const addSystemMessage = useCallback((text: string) => {
    const msg: ChatMessage = {
      id: `msg-${++idCounter.current}`,
      role: "system",
      text,
      timestamp: Date.now(),
    };
    setMessages((prev) => [...prev, msg]);
  }, []);

  const fetchChatConfig = useCallback(async (folderPath: string, sessionId?: string) => {
    try {
      const params = new URLSearchParams({ folderPath });
      if (sessionId) params.set("sessionId", sessionId);
      const res = await fetch(`/api/chat/config?${params}`);
      if (!res.ok) return;
      const data = (await res.json()) as { yoloMode: boolean };
      setYoloModeState(Boolean(data.yoloMode));
    } catch {
      setYoloModeState(false);
    }
  }, []);

  const setYoloMode = useCallback(
    async (folderPath: string, value: boolean, sessionId?: string) => {
      try {
        const res = await fetch("/api/chat/config", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ folderPath, sessionId, yoloMode: value }),
        });
        if (res.ok) setYoloModeState(value);
      } catch {
        // no-op
      }
    },
    [],
  );

  const clearPendingToolCall = useCallback(() => {
    setPendingToolCall(null);
  }, []);

  const onApproveToolCall = useCallback(() => {
    setPendingToolCall(null);
    setThinkingState(null);
    addSystemMessage("Tool call approved. Execution not yet implemented.");
  }, [addSystemMessage]);

  const onRejectToolCall = useCallback(() => {
    setPendingToolCall(null);
    setThinkingState(null);
    addSystemMessage("Tool call rejected by user.");
  }, [addSystemMessage]);

  return {
    messages,
    sending,
    sendMessage,
    clearMessages,
    addSystemMessage,
    thinkingState,
    activeModel,
    pendingToolCall,
    clearPendingToolCall,
    onApproveToolCall,
    onRejectToolCall,
    yoloMode,
    setYoloMode,
    fetchChatConfig,
  };
}
