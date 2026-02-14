"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Send, ImagePlus, X, Loader2, Sparkles, RotateCcw, ShieldAlert, ShieldCheck, FolderLock } from "lucide-react";
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ImageAttachment {
  id: string;
  data: string;
  mimeType: string;
  preview: string;
}

interface Message {
  id: string;
  role: "user" | "model";
  text: string;
  images?: ImageAttachment[];
  timestamp: number;
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function cn(...inputs: (string | undefined | false | null)[]): string {
  return twMerge(clsx(inputs));
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

// ---------------------------------------------------------------------------
// Component: MessageBubble
// ---------------------------------------------------------------------------

function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === "user";

  return (
    <div
      className={cn(
        "flex w-full gap-3",
        isUser ? "justify-end" : "justify-start",
      )}
    >
      {!isUser && (
        <div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-violet-600">
          <Sparkles className="h-4 w-4 text-white" />
        </div>
      )}

      <div
        className={cn(
          "max-w-[75%] rounded-2xl px-4 py-3 text-sm leading-relaxed",
          isUser
            ? "bg-blue-600 text-white"
            : "bg-zinc-800 text-zinc-100",
        )}
      >
        {message.images && message.images.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {message.images.map((img) => (
              <img
                key={img.id}
                src={img.preview}
                alt="Attached"
                className="h-20 w-20 rounded-lg object-cover"
              />
            ))}
          </div>
        )}
        <p className="whitespace-pre-wrap">{message.text}</p>
      </div>

      {isUser && (
        <div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-600">
          <span className="text-xs font-bold text-white">U</span>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component: ImagePreview
// ---------------------------------------------------------------------------

function ImagePreview({
  images,
  onRemove,
}: {
  images: ImageAttachment[];
  onRemove: (id: string) => void;
}) {
  if (images.length === 0) return null;

  return (
    <div className="flex gap-2 overflow-x-auto px-4 pb-2">
      {images.map((img) => (
        <div key={img.id} className="group relative shrink-0">
          <img
            src={img.preview}
            alt="Preview"
            className="h-16 w-16 rounded-lg object-cover ring-1 ring-zinc-700"
          />
          <button
            type="button"
            onClick={() => onRemove(img.id)}
            className="absolute -top-1.5 -right-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-white opacity-0 transition-opacity group-hover:opacity-100"
            aria-label="Remove image"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Types – System Status
// ---------------------------------------------------------------------------

interface GeminiStatus {
  isLoggedIn: boolean;
  isCurrentFolderTrusted: boolean;
  trustedFolders: string[];
  currentPath: string;
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export default function Home() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [selectedImages, setSelectedImages] = useState<ImageAttachment[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  // System status
  const [status, setStatus] = useState<GeminiStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [authorizing, setAuthorizing] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // -------------------------------------------------------------------------
  // System status check
  // -------------------------------------------------------------------------

  const fetchStatus = useCallback(async () => {
    try {
      setStatusLoading(true);
      const res = await fetch("/api/gemini/status");
      if (res.ok) {
        const data: GeminiStatus = await res.json();
        setStatus(data);
      }
    } catch {
      // Silently fail – the overlay simply won't dismiss
    } finally {
      setStatusLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  const handleAuthorize = useCallback(async () => {
    if (!status) return;
    setAuthorizing(true);
    try {
      const res = await fetch("/api/gemini/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: status.currentPath }),
      });
      if (res.ok) {
        const data: GeminiStatus = await res.json();
        setStatus(data);
      }
    } catch {
      // Silently fail
    } finally {
      setAuthorizing(false);
    }
  }, [status]);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 160)}px`;
    }
  }, [input]);

  const handleImageSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (!files) return;

      Array.from(files).forEach((file) => {
        const reader = new FileReader();
        reader.onload = () => {
          const dataUrl = reader.result as string;
          const attachment: ImageAttachment = {
            id: generateId(),
            data: dataUrl,
            mimeType: file.type || "image/png",
            preview: dataUrl,
          };
          setSelectedImages((prev) => [...prev, attachment]);
        };
        reader.readAsDataURL(file);
      });

      // Reset input so re-selecting the same file works
      e.target.value = "";
    },
    [],
  );

  const removeImage = useCallback((id: string) => {
    setSelectedImages((prev) => prev.filter((img) => img.id !== id));
  }, []);

  const sendMessage = useCallback(async () => {
    const trimmed = input.trim();
    if (!trimmed && selectedImages.length === 0) return;
    if (isLoading) return;

    // Build the user message
    const userMessage: Message = {
      id: generateId(),
      role: "user",
      text: trimmed,
      images: selectedImages.length > 0 ? [...selectedImages] : undefined,
      timestamp: Date.now(),
    };

    // Optimistic UI update
    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setSelectedImages([]);
    setIsLoading(true);

    try {
      const payload = {
        message: trimmed,
        images: selectedImages.map((img) => ({
          data: img.data,
          mimeType: img.mimeType,
        })),
      };

      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();

      if (!res.ok) {
        const errorMessage: Message = {
          id: generateId(),
          role: "model",
          text: `Error: ${data.error ?? "Unknown error from API."}`,
          timestamp: Date.now(),
        };
        setMessages((prev) => [...prev, errorMessage]);
        return;
      }

      const modelMessage: Message = {
        id: generateId(),
        role: "model",
        text: data.response ?? "(empty response)",
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, modelMessage]);
    } catch (err) {
      const errorText =
        err instanceof Error ? err.message : "Network error";
      const errorMessage: Message = {
        id: generateId(),
        role: "model",
        text: `Error: ${errorText}`,
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  }, [input, selectedImages, isLoading]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    },
    [sendMessage],
  );

  const lastMessage = messages[messages.length - 1];
  const lastIsError =
    lastMessage?.role === "model" && lastMessage.text.startsWith("Error:");
  const lastUserMessage = [...messages].reverse().find((m) => m.role === "user");

  const handleRetry = useCallback(async () => {
    if (!lastUserMessage || isLoading) return;

    setMessages((prev) => prev.slice(0, -1));
    setIsLoading(true);

    try {
      const payload = {
        message: lastUserMessage.text.trim(),
        images: (lastUserMessage.images ?? []).map((img) => ({
          data: img.data,
          mimeType: img.mimeType,
        })),
      };

      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();

      if (!res.ok) {
        const errorMessage: Message = {
          id: generateId(),
          role: "model",
          text: `Error: ${data.error ?? "Unknown error from API."}`,
          timestamp: Date.now(),
        };
        setMessages((prev) => [...prev, errorMessage]);
        return;
      }

      const modelMessage: Message = {
        id: generateId(),
        role: "model",
        text: data.response ?? "(empty response)",
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, modelMessage]);
    } catch (err) {
      const errorText =
        err instanceof Error ? err.message : "Network error";
      const errorMessage: Message = {
        id: generateId(),
        role: "model",
        text: `Error: ${errorText}`,
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  }, [lastUserMessage, isLoading]);

  // Whether the overlay should be shown
  const showSetupOverlay =
    !statusLoading && status !== null && !status.isCurrentFolderTrusted;

  return (
    <div className="flex h-dvh flex-col bg-zinc-950 font-sans text-zinc-100">
      {/* ---- Setup Required Overlay ---- */}
      {showSetupOverlay && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-zinc-950/90 backdrop-blur-sm">
          <div className="mx-4 flex w-full max-w-md flex-col items-center gap-6 rounded-2xl border border-zinc-800 bg-zinc-900 p-8 text-center shadow-2xl">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-amber-500/10">
              <ShieldAlert className="h-8 w-8 text-amber-400" />
            </div>

            <div>
              <h2 className="text-xl font-semibold text-zinc-100">
                Setup Required
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-zinc-400">
                The current working directory has not been authorized for the
                Gemini CLI. Trust this folder to continue.
              </p>
            </div>

            <div className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-4 py-3">
              <div className="flex items-center gap-2 text-xs text-zinc-500">
                <FolderLock className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate font-mono">{status.currentPath}</span>
              </div>
            </div>

            <button
              type="button"
              onClick={handleAuthorize}
              disabled={authorizing}
              className={cn(
                "flex w-full items-center justify-center gap-2 rounded-xl px-5 py-3 text-sm font-medium transition-colors",
                authorizing
                  ? "cursor-not-allowed bg-violet-600/50 text-violet-300"
                  : "bg-violet-600 text-white hover:bg-violet-500",
              )}
            >
              {authorizing ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Authorizing…
                </>
              ) : (
                <>
                  <ShieldCheck className="h-4 w-4" />
                  Authorize This Folder
                </>
              )}
            </button>

            {!status.isLoggedIn && (
              <p className="text-xs text-amber-400/80">
                Note: You do not appear to be logged in (no oauth_creds.json
                found). Run <code className="font-mono">gemini auth login</code>{" "}
                first.
              </p>
            )}
          </div>
        </div>
      )}

      {/* Header */}
      <header className="flex shrink-0 items-center gap-3 border-b border-zinc-800 px-6 py-4">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-violet-600">
          <Sparkles className="h-5 w-5 text-white" />
        </div>
        <div>
          <h1 className="text-lg font-semibold leading-tight">Gemini Local</h1>
          <p className="text-xs text-zinc-500">
            Persistent CLI session &middot; Multi-modal
          </p>
        </div>
      </header>

      {/* Message List */}
      <main className="flex-1 overflow-y-auto px-4 py-6">
        <div className="mx-auto flex max-w-3xl flex-col gap-4">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center py-24 text-center text-zinc-600">
              <Sparkles className="mb-4 h-12 w-12 text-zinc-700" />
              <p className="text-lg font-medium text-zinc-500">
                Start a conversation
              </p>
              <p className="mt-1 text-sm">
                Send a message or attach images to begin.
              </p>
            </div>
          )}

          {messages.map((msg) => (
            <MessageBubble key={msg.id} message={msg} />
          ))}

          {isLoading && (
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-violet-600">
                <Sparkles className="h-4 w-4 text-white" />
              </div>
              <div className="flex items-center gap-2 rounded-2xl bg-zinc-800 px-4 py-3 text-sm text-zinc-400">
                <Loader2 className="h-4 w-4 animate-spin" />
                Thinking...
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </main>

      {/* Input Area */}
      <footer className="shrink-0 border-t border-zinc-800 bg-zinc-900">
        <div className="mx-auto max-w-3xl">
          {lastIsError && (
            <div className="flex items-center justify-center gap-2 px-4 py-2">
              <button
                type="button"
                onClick={handleRetry}
                disabled={isLoading}
                className={cn(
                  "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
                  isLoading
                    ? "cursor-not-allowed text-zinc-500"
                    : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200",
                )}
                aria-label="Retry last message"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Retry
              </button>
            </div>
          )}
          <ImagePreview images={selectedImages} onRemove={removeImage} />

          <div className="flex items-end gap-2 px-4 py-3">
            {/* Hidden file input */}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={handleImageSelect}
            />

            {/* Image attach button */}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
              aria-label="Attach images"
            >
              <ImagePlus className="h-5 w-5" />
            </button>

            {/* Text input */}
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Message Gemini..."
              rows={1}
              className="max-h-40 min-h-[2.5rem] flex-1 resize-none rounded-xl border border-zinc-700 bg-zinc-800 px-4 py-2.5 text-sm text-zinc-100 placeholder-zinc-500 outline-none transition-colors focus:border-violet-500 focus:ring-1 focus:ring-violet-500"
            />

            {/* Send button */}
            <button
              type="button"
              onClick={sendMessage}
              disabled={isLoading || (!input.trim() && selectedImages.length === 0)}
              className={cn(
                "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition-colors",
                isLoading || (!input.trim() && selectedImages.length === 0)
                  ? "cursor-not-allowed text-zinc-600"
                  : "bg-violet-600 text-white hover:bg-violet-500",
              )}
              aria-label="Send message"
            >
              {isLoading ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <Send className="h-5 w-5" />
              )}
            </button>
          </div>

          <p className="px-4 pb-3 text-center text-[11px] text-zinc-600">
            Gemini can make mistakes. Verify important information.
          </p>
        </div>
      </footer>
    </div>
  );
}
