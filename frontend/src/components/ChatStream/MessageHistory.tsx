import { useCallback, useEffect, useRef, useState } from "react";
import { useMessageHistoryStore } from "@/store/messageHistoryStore";

interface MessageHistoryProps {
  onSelect: (text: string) => void;
  onClose: () => void;
}

export function MessageHistory({ onSelect, onClose }: MessageHistoryProps) {
  const history = useMessageHistoryStore((s) => s.history);
  const [filter, setFilter] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const filtered = filter
    ? history.filter((m) => m.toLowerCase().includes(filter.toLowerCase()))
    : history;

  useEffect(() => {
    setSelectedIndex(0);
  }, [filter]);

  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", handleGlobalKeyDown);
    return () => document.removeEventListener("keydown", handleGlobalKeyDown);
  }, [onClose]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((i) => (i + 1) % Math.max(filtered.length, 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((i) => (i - 1 + Math.max(filtered.length, 1)) % Math.max(filtered.length, 1));
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (filtered.length > 0) {
          onSelect(filtered[selectedIndex]);
        }
      }
    },
    [filtered, selectedIndex, onSelect],
  );

  return (
    <div className="input-history">
      <input
        ref={inputRef}
        className="input-history-filter"
        type="text"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Filter history..."
      />
      {filtered.length === 0 ? (
        <div className="input-history-empty">
          {history.length === 0 ? "No history" : "No matches"}
        </div>
      ) : (
        <div className="input-history-list">
          {filtered.map((msg, i) => (
            <button
              key={i}
              ref={i === selectedIndex ? (el) => el?.scrollIntoView({ block: "nearest" }) : undefined}
              className={`input-history-item ${i === selectedIndex ? "input-history-active" : ""}`}
              onMouseDown={(e) => {
                e.preventDefault();
                onSelect(msg);
              }}
            >
              {msg}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
