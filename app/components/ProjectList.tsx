"use client";

import {
  RefreshCw,
  Flame,
  Trash2,
  XCircle,
  FolderOpen,
  Server,
} from "lucide-react";
import type { FolderEntry, FolderStatus } from "@/lib/hub-state";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ProjectListProps {
  folders: FolderEntry[];
  activeFolder: string | null;
  loading: boolean;
  onSelect: (path: string) => void;
  onRefresh: () => void;
  onWarmUp: (path: string) => void;
  onClearSession: (path: string) => void;
  onUnregister: (path: string) => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const STATUS_CONFIG: Record<
  FolderStatus,
  { icon: string; label: string; className: string }
> = {
  ready: { icon: "🟢", label: "Ready", className: "text-success" },
  cold: { icon: "⚪", label: "Cold", className: "text-text-muted" },
  initializing: {
    icon: "🔄",
    label: "Initializing",
    className: "text-warning",
  },
};

function shortPath(fullPath: string): string {
  const parts = fullPath.split("/");
  return parts.length > 2
    ? `~/${parts.slice(-2).join("/")}`
    : fullPath;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ProjectList({
  folders,
  activeFolder,
  loading,
  onSelect,
  onRefresh,
  onWarmUp,
  onClearSession,
  onUnregister,
}: ProjectListProps) {
  const readyCount = folders.filter((f) => f.status === "ready").length;

  return (
    <aside className="flex h-full flex-col border-r border-border bg-surface-1">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <Server size={14} className="text-accent" />
          <h2 className="text-sm font-semibold tracking-wide uppercase text-text-secondary">
            Registry
          </h2>
        </div>
        <button
          onClick={onRefresh}
          className="rounded p-1 text-text-muted transition-colors hover:bg-surface-3 hover:text-text-primary"
          title="Refresh registry"
        >
          <RefreshCw size={14} />
        </button>
      </div>

      {/* Session count */}
      <div className="border-b border-border px-4 py-2">
        <span className="font-mono text-xs text-text-muted">
          {readyCount}/{folders.length} sessions active
        </span>
      </div>

      {/* Folder list */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <RefreshCw size={16} className="animate-spin text-text-muted" />
          </div>
        ) : folders.length === 0 ? (
          <div className="px-4 py-8 text-center">
            <FolderOpen size={24} className="mx-auto mb-2 text-text-muted" />
            <p className="text-xs text-text-muted">
              No projects registered.
            </p>
            <p className="mt-1 text-xs text-text-muted">
              Use the API to add folders.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {folders.map((folder) => {
              const isActive = folder.path === activeFolder;
              const cfg = STATUS_CONFIG[folder.status];

              return (
                <li key={folder.path}>
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => onSelect(folder.path)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onSelect(folder.path);
                      }
                    }}
                    className={`w-full cursor-pointer px-4 py-3 text-left transition-colors ${
                      isActive
                        ? "bg-surface-3/60 border-l-2 border-accent"
                        : "border-l-2 border-transparent hover:bg-surface-2"
                    }`}
                  >
                    {/* Name + status */}
                    <div className="flex items-center gap-2">
                      <span className="text-xs" title={cfg.label}>
                        {cfg.icon}
                      </span>
                      <span className="truncate font-mono text-xs font-medium text-text-primary">
                        {shortPath(folder.path)}
                      </span>
                    </div>

                    {/* Full path */}
                    <p className="mt-1 truncate font-mono text-[10px] text-text-muted">
                      {folder.path}
                    </p>

                    {/* Actions */}
                    <div className="mt-2 flex items-center gap-1">
                      {folder.status !== "ready" && (
                        <ActionButton
                          icon={<Flame size={11} />}
                          label="Warm Up"
                          onClick={(e) => {
                            e.stopPropagation();
                            onWarmUp(folder.path);
                          }}
                          className="text-warning hover:bg-warning/10"
                        />
                      )}
                      {folder.status === "ready" && (
                        <ActionButton
                          icon={<XCircle size={11} />}
                          label="Clear"
                          onClick={(e) => {
                            e.stopPropagation();
                            onClearSession(folder.path);
                          }}
                          className="text-text-muted hover:bg-surface-3"
                        />
                      )}
                      <ActionButton
                        icon={<Trash2 size={11} />}
                        label="Unregister"
                        onClick={(e) => {
                          e.stopPropagation();
                          onUnregister(folder.path);
                        }}
                        className="text-danger hover:bg-danger/10"
                      />
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </aside>
  );
}

// ---------------------------------------------------------------------------
// Sub-component: Tiny action button
// ---------------------------------------------------------------------------

function ActionButton({
  icon,
  label,
  onClick,
  className = "",
}: {
  icon: React.ReactNode;
  label: string;
  onClick: (e: React.MouseEvent) => void;
  className?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[10px] transition-colors ${className}`}
      title={label}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}
