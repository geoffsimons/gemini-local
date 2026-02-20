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

      try {
        const res = await fetch("/api/chat/prompt", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            folderPath,
            message: text || undefined,
            images: images?.length ? images : undefined,
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

        let partialData = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          partialData += chunk;

          const lines = partialData.split("\n\n");
          partialData = lines.pop() || "";

          for (const line of lines) {
            const cleanLine = line.trim();
            if (!cleanLine.startsWith("data: ")) continue;

            try {
              const event = JSON.parse(cleanLine.slice(6));

              setMessages((prev) =>
                prev.map((m) => {
                  if (m.id !== assistantId) return m;

                  switch (event.type) {
                    case "MESSAGE":
                      return {
                        ...m,
                        text: event.delta ? m.text + event.content : event.content,
                      };
                    case "THOUGHT":
                      return {
                        ...m,
                        thought: (m.thought || "") + event.content + "\n",
                      };
                    case "ERROR":
                      return {
                        ...m,
                        text: m.text + `\n\n[Error: ${event.message}]`,
                      };
                    default:
                      return m;
                  }
                }),
              );
            } catch (err) {
              console.error("Failed to parse SSE event", err);
            }
          }
        }
      } catch (err: any) {
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

  return { messages, sending, sendMessage, clearMessages, addSystemMessage };
}
