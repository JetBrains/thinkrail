import { useEffect, useRef } from "react";
import type { ViewMode } from "@/context/ViewModeContext.tsx";

export interface ContextMenuAction {
  label: string;
  icon?: string;
  onClick: () => void;
  separator?: boolean;
  disabled?: boolean;
}

interface SessionContextMenuProps {
  x: number;
  y: number;
  viewMode: ViewMode;
  onSwitchViewMode: (mode: ViewMode) => void;
  onExpandAll: () => void;
  onCollapseEvents: () => void;
  onCollapseAll: () => void;
  onCopyTranscript: () => void;
  /** Set when right-clicked on an answered question */
  onReviseAnswer?: () => void;
  onClose: () => void;
}

export function SessionContextMenu({
  x,
  y,
  viewMode,
  onSwitchViewMode,
  onExpandAll,
  onCollapseEvents,
  onCollapseAll,
  onCopyTranscript,
  onReviseAnswer,
  onClose,
}: SessionContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [onClose]);

  // Adjust position to stay within viewport
  useEffect(() => {
    if (!menuRef.current) return;
    const rect = menuRef.current.getBoundingClientRect();
    if (rect.right > window.innerWidth) {
      menuRef.current.style.left = `${x - rect.width}px`;
    }
    if (rect.bottom > window.innerHeight) {
      menuRef.current.style.top = `${y - rect.height}px`;
    }
  }, [x, y]);

  const nextMode: ViewMode = viewMode === "classic" ? "compact" : "classic";

  const items: ContextMenuAction[] = [
    {
      label: `Switch to ${nextMode} view`,
      icon: nextMode === "compact" ? "\u{1F4CB}" : "\u{1F5C2}\uFE0F",
      onClick: () => { onSwitchViewMode(nextMode); onClose(); },
    },
    {
      label: "Expand all",
      icon: "\u25BC",
      onClick: () => { onExpandAll(); onClose(); },
      separator: true,
    },
    {
      label: "Collapse events",
      icon: "\u25B6",
      onClick: () => { onCollapseEvents(); onClose(); },
    },
    {
      label: "Collapse all",
      icon: "\u25B6\u25B6",
      onClick: () => { onCollapseAll(); onClose(); },
    },
    {
      label: "Copy transcript",
      icon: "\u{1F4CB}",
      onClick: () => { onCopyTranscript(); onClose(); },
      separator: true,
    },
  ];

  if (onReviseAnswer) {
    items.push({
      label: "Revise answer",
      icon: "\u{1F504}",
      onClick: () => { onReviseAnswer(); onClose(); },
      separator: true,
    });
  }

  return (
    <div
      ref={menuRef}
      className="session-ctx-menu"
      style={{ left: x, top: y }}
    >
      {items.map((item, idx) => (
        <div key={idx}>
          {item.separator && idx > 0 && <div className="session-ctx-menu-sep" />}
          <button
            className={`session-ctx-menu-item${item.disabled ? " session-ctx-menu-item--disabled" : ""}`}
            onClick={item.disabled ? undefined : item.onClick}
          >
            {item.icon && <span className="session-ctx-menu-icon">{item.icon}</span>}
            <span>{item.label}</span>
          </button>
        </div>
      ))}
    </div>
  );
}
