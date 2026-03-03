import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useUiStore } from "@/store/uiStore.ts";
import { useSpecStore } from "@/store/specStore.ts";
import { useSessionStore } from "@/store/sessionStore.ts";
import "./CommandPalette.css";

interface PaletteItem {
  id: string;
  title: string;
  category: "spec" | "session" | "action";
  action: () => void;
}

type PrefixMode = "all" | "specs" | "sessions" | "actions";

function detectMode(query: string): { mode: PrefixMode; cleanQuery: string } {
  if (query.startsWith("#")) return { mode: "specs", cleanQuery: query.slice(1) };
  if (query.startsWith("@")) return { mode: "sessions", cleanQuery: query.slice(1) };
  if (query.startsWith("/")) return { mode: "actions", cleanQuery: query.slice(1) };
  return { mode: "all", cleanQuery: query };
}

function fuzzyMatch(text: string, query: string): number {
  if (!query) return 1;
  const lower = text.toLowerCase();
  const q = query.toLowerCase();
  if (lower.startsWith(q)) return 3;
  if (lower.includes(q)) return 1;
  return 0;
}

export function CommandPalette() {
  const open = useUiStore((s) => s.paletteOpen);
  const togglePalette = useUiStore((s) => s.togglePalette);
  const openModal = useUiStore((s) => s.openModal);
  const selectSpec = useSpecStore((s) => s.selectSpec);
  const setRightTab = useUiStore((s) => s.setRightTab);
  const specs = useSpecStore((s) => s.specs);
  const sessions = useSessionStore((s) => s.sessions);
  const switchSession = useSessionStore((s) => s.switchSession);

  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQuery("");
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  const { mode, cleanQuery } = useMemo(() => detectMode(query), [query]);

  const items = useMemo((): PaletteItem[] => {
    const result: PaletteItem[] = [];

    if (mode === "all" || mode === "specs") {
      for (const s of specs) {
        const score = fuzzyMatch(s.title, cleanQuery);
        if (score > 0) {
          result.push({
            id: `spec-${s.id}`,
            title: s.title,
            category: "spec",
            action: () => { selectSpec(s.id); setRightTab("spec"); togglePalette(); },
          });
        }
      }
    }

    if (mode === "all" || mode === "sessions") {
      for (const [, s] of sessions) {
        const score = fuzzyMatch(s.name, cleanQuery);
        if (score > 0) {
          result.push({
            id: `session-${s.taskId}`,
            title: s.name,
            category: "session",
            action: () => { switchSession(s.taskId); togglePalette(); },
          });
        }
      }
    }

    if (mode === "all" || mode === "actions") {
      const actions: PaletteItem[] = [
        { id: "action-new", title: "New session", category: "action", action: () => { openModal(); togglePalette(); } },
        { id: "action-graph", title: "Focus graph", category: "action", action: () => { setRightTab("graph"); togglePalette(); } },
        { id: "action-spec", title: "Focus spec view", category: "action", action: () => { setRightTab("spec"); togglePalette(); } },
      ];
      for (const a of actions) {
        if (fuzzyMatch(a.title, cleanQuery) > 0) result.push(a);
      }
    }

    return result;
  }, [specs, sessions, mode, cleanQuery, selectSpec, setRightTab, togglePalette, switchSession, openModal]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, items.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter" && items[selectedIndex]) {
        e.preventDefault();
        items[selectedIndex].action();
      } else if (e.key === "Escape") {
        e.preventDefault();
        togglePalette();
      } else if (e.key === "Tab") {
        e.preventDefault();
        const prefixes = ["", "#", "@", "/"];
        const current = prefixes.indexOf(query[0] ?? "");
        const next = (current + 1) % prefixes.length;
        setQuery(prefixes[next]);
      }
    },
    [items, selectedIndex, togglePalette, query],
  );

  if (!open) return null;

  const BADGES: Record<string, string> = { spec: "spec", session: "session", action: "action" };

  return (
    <div className="palette-backdrop" onClick={togglePalette}>
      <div className="palette-container" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="palette-input"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setSelectedIndex(0); }}
          onKeyDown={handleKeyDown}
          placeholder="Search specs, sessions, actions... (# @ /)"
        />
        <div className="palette-results">
          {items.length === 0 && (
            <div className="palette-empty">No results</div>
          )}
          {items.map((item, i) => (
            <button
              key={item.id}
              className={`palette-item ${i === selectedIndex ? "palette-item-selected" : ""}`}
              onClick={item.action}
              onMouseEnter={() => setSelectedIndex(i)}
            >
              <span className="palette-item-title">{item.title}</span>
              <span className="palette-item-badge">{BADGES[item.category]}</span>
            </button>
          ))}
        </div>
        <div className="palette-footer">
          <span>{"\u2191\u2193"} navigate</span>
          <span>{"\u21B5"} select</span>
          <span>Tab mode</span>
          <span>Esc close</span>
        </div>
      </div>
    </div>
  );
}
