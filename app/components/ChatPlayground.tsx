"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import {
  Send,
  ImagePlus,
  X,
  FileText,
  ChevronDown,
  Loader2,
  Bot,
  User,
} from "lucide-react";
import type { ChatMessage, FolderEntry } from "@/lib/hub-state";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ImageAttachment {
  id: string;
  data: string;
  mimeType: string;
  preview: string; // data URI
}

interface ChatPlaygroundProps {
  folders: FolderEntry[];
  activeFolder: string | null;
  onSelectFolder: (path: string) => void;
  messages: ChatMessage[];
  sending: boolean;
  onSendMessage: (
    folderPath: string,
    text: string,
    images?: Array<{ data: string; mimeType: string }>,
  ) => Promise<void>;
  onClearMessages: () => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function shortName(fullPath: string): string {
  const parts = fullPath.split("/");
  return parts[parts.length - 1] || fullPath;
}

let attachmentCounter = 0;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ChatPlayground({
  folders,
  activeFolder,
  onSelectFolder,
  messages,
  sending,
  onSendMessage,
  onClearMessages,
}: ChatPlaygroundProps) {
  const [input, setInput] = useState("");
  const [images, setImages] = useState<ImageAttachment[]>([]);
  const [showSystemPrompt, setShowSystemPrompt] = useState(false);
  const [systemPrompt, setSystemPrompt] = useState<string | null>(null);
  const [loadingPrompt, setLoadingPrompt] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll on new messages
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

  // ---------------------------------------------------------------------------
  // Image attachment handling
  // ---------------------------------------------------------------------------

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (!files) return;

      Array.from(files).forEach((file) => {
        if (!file.type.startsWith("image/")) return;

        const reader = new FileReader();
        reader.onload = () => {
          const dataUri = reader.result as string;
          const base64 = dataUri.split(",")[1];
          const attachment: ImageAttachment = {
            id: `att-${++attachmentCounter}`,
            data: base64,
            mimeType: file.type,
            preview: dataUri,
          };
          setImages((prev) => [...prev, attachment]);
        };
        reader.readAsDataURL(file);
      });

      // Reset the input so the same file can be re-selected
      e.target.value = "";
    },
    [],
  );

  const removeImage = useCallback((id: string) => {
    setImages((prev) => prev.filter((img) => img.id !== id));
  }, []);

  // ---------------------------------------------------------------------------
  // System prompt toggle
  // ---------------------------------------------------------------------------

  const toggleSystemPrompt = useCallback(async () => {
    if (showSystemPrompt) {
      setShowSystemPrompt(false);
      return;
    }
    if (!activeFolder) return;

    setShowSystemPrompt(true);
    if (systemPrompt === null) {
      setLoadingPrompt(true);
      try {
        // We read the GEMINI.md via a status-like inference —
        // For now, show a placeholder since there's no dedicated API for this.
        setSystemPrompt(
          `# System Instructions\n\nProject: ${activeFolder}\n\nThe GEMINI.md for this project is loaded automatically when the session is initialized. Use "Warm Up" to load the session.`,
        );
      } finally {
        setLoadingPrompt(false);
      }
    }
  }, [showSystemPrompt, activeFolder, systemPrompt]);

  // Reset system prompt when folder changes
  useEffect(() => {
    setSystemPrompt(null);
    setShowSystemPrompt(false);
  }, [activeFolder]);

  // ---------------------------------------------------------------------------
  // Send
  // ---------------------------------------------------------------------------

  const handleSend = useCallback(async () => {
    if (!activeFolder) return;
    if (!input.trim() && images.length === 0) return;

    const imagePayloads = images.map((img) => ({
      data: img.data,
      mimeType: img.mimeType,
    }));

    const text = input.trim();
    setInput("");
    setImages([]);

    await onSendMessage(
      activeFolder,
      text,
      imagePayloads.length > 0 ? imagePayloads : undefined,
    );
  }, [activeFolder, input, images, onSendMessage]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <main className="flex h-full flex-col bg-surface-0">
      {/* Toolbar */}
      <div className="flex items-center gap-3 border-b border-border px-4 py-2.5">
        {/* Folder selector */}
        <div className="relative">
          <select
            value={activeFolder ?? ""}
            onChange={(e) => onSelectFolder(e.target.value)}
            className="appearance-none rounded border border-border bg-surface-2 py-1.5 pl-3 pr-8 font-mono text-xs text-text-primary outline-none transition-colors focus:border-accent"
          >
            {folders.length === 0 && (
              <option value="">No projects</option>
            )}
            {folders.map((f) => (
              <option key={f.path} value={f.path}>
                {shortName(f.path)}
              </option>
            ))}
          </select>
          <ChevronDown
            size={12}
            className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-text-muted"
          />
        </div>

        {/* Target path display */}
        {activeFolder && (
          <span className="truncate font-mono text-[10px] text-text-muted">
            {activeFolder}
          </span>
        )}

        <div className="flex-1" />

        {/* System prompt toggle */}
        <button
          onClick={toggleSystemPrompt}
          className={`flex items-center gap-1.5 rounded px-2 py-1 font-mono text-[11px] transition-colors ${
            showSystemPrompt
              ? "bg-accent/20 text-accent"
              : "text-text-muted hover:bg-surface-2 hover:text-text-secondary"
          }`}
        >
          <FileText size={12} />
          System
        </button>

        {/* Clear chat */}
        <button
          onClick={onClearMessages}
          className="rounded px-2 py-1 font-mono text-[11px] text-text-muted transition-colors hover:bg-surface-2 hover:text-text-secondary"
        >
          Clear Chat
        </button>
      </div>

      {/* System prompt panel (collapsible) */}
      {showSystemPrompt && (
        <div className="border-b border-border bg-surface-1 px-4 py-3">
          {loadingPrompt ? (
            <Loader2 size={14} className="animate-spin text-text-muted" />
          ) : (
            <pre className="max-h-40 overflow-y-auto whitespace-pre-wrap font-mono text-xs text-text-secondary">
              {systemPrompt}
            </pre>
          )}
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <Bot size={32} className="mb-3 text-text-muted" />
            <p className="text-sm text-text-muted">
              No messages yet.
            </p>
            <p className="mt-1 text-xs text-text-muted">
              Select a project and start chatting.
            </p>
          </div>
        ) : (
          <div className="mx-auto max-w-3xl space-y-4">
            {messages.map((msg) => (
              <MessageBubble key={msg.id} message={msg} />
            ))}
            {sending && (
              <div className="flex items-center gap-2 py-2">
                <Loader2
                  size={14}
                  className="animate-spin text-accent"
                />
                <span className="font-mono text-xs text-text-muted">
                  Thinking...
                </span>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Image previews */}
      {images.length > 0 && (
        <div className="flex gap-2 border-t border-border bg-surface-1 px-4 py-2">
          {images.map((img) => (
            <div key={img.id} className="group relative">
              <img
                src={img.preview}
                alt="attachment"
                className="h-14 w-14 rounded border border-border object-cover"
              />
              <button
                onClick={() => removeImage(img.id)}
                className="absolute -right-1 -top-1 rounded-full bg-surface-3 p-0.5 opacity-0 transition-opacity group-hover:opacity-100"
              >
                <X size={10} className="text-text-primary" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Input bar */}
      <div className="border-t border-border bg-surface-1 px-4 py-3">
        <div className="mx-auto flex max-w-3xl items-end gap-2">
          {/* Attach images */}
          <button
            onClick={() => fileInputRef.current?.click()}
            className="mb-0.5 rounded p-1.5 text-text-muted transition-colors hover:bg-surface-3 hover:text-text-primary"
            title="Attach images"
          >
            <ImagePlus size={18} />
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={handleFileSelect}
          />

          {/* Text input */}
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              activeFolder
                ? "Send a message... (Shift+Enter for newline)"
                : "Select a project first"
            }
            disabled={!activeFolder || sending}
            rows={1}
            className="flex-1 resize-none rounded border border-border bg-surface-2 px-3 py-2 font-mono text-sm text-text-primary placeholder:text-text-muted outline-none transition-colors focus:border-accent disabled:opacity-50"
          />

          {/* Send */}
          <button
            onClick={handleSend}
            disabled={
              !activeFolder || sending || (!input.trim() && images.length === 0)
            }
            className="mb-0.5 rounded bg-accent p-2 text-white transition-colors hover:bg-accent-hover disabled:opacity-30 disabled:cursor-not-allowed"
            title="Send message"
          >
            {sending ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <Send size={16} />
            )}
          </button>
        </div>
      </div>
    </main>
  );
}

// ---------------------------------------------------------------------------
// Sub-component: Message bubble
// ---------------------------------------------------------------------------

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";

  return (
    <div className={`flex gap-3 ${isUser ? "justify-end" : "justify-start"}`}>
      {!isUser && (
        <div className="mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded bg-accent/20">
          <Bot size={14} className="text-accent" />
        </div>
      )}

      <div
        className={`max-w-[80%] rounded-lg px-3.5 py-2.5 ${
          isUser
            ? "bg-accent/15 text-text-primary"
            : "bg-surface-2 text-text-primary"
        }`}
      >
        {/* Image previews */}
        {message.images && message.images.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {message.images.map((src, i) => (
              <img
                key={i}
                src={src}
                alt={`attached ${i + 1}`}
                className="h-16 w-16 rounded border border-border object-cover"
              />
            ))}
          </div>
        )}

        {/* Text content */}
        <div className="whitespace-pre-wrap font-mono text-xs leading-relaxed">
          {message.text}
        </div>

        {/* Timestamp */}
        <div className="mt-1.5 text-right font-mono text-[9px] text-text-muted">
          {new Date(message.timestamp).toLocaleTimeString()}
        </div>
      </div>

      {isUser && (
        <div className="mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded bg-surface-3">
          <User size={14} className="text-text-secondary" />
        </div>
      )}
    </div>
  );
}
