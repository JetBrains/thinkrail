import { useCallback, useEffect, useState } from "react";

interface Position { x: number; y: number; }

interface SubsessionContextMenuProps {
  containerRef: React.RefObject<HTMLElement | null>;
  sessionId: string;
}

export function SubsessionContextMenu({ containerRef, sessionId }: SubsessionContextMenuProps) {
  const [visible, setVisible] = useState(false);
  const [position, setPosition] = useState<Position>({ x: 0, y: 0 });
  const [selectedText, setSelectedText] = useState("");

  const handleContextMenu = useCallback((e: MouseEvent) => {
    const selection = window.getSelection();
    const text = selection?.toString().trim();
    if (!text) return;
    e.preventDefault();
    setSelectedText(text);
    setPosition({ x: e.clientX, y: e.clientY });
    setVisible(true);
  }, []);

  const handleClick = useCallback(() => setVisible(false), []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.addEventListener("contextmenu", handleContextMenu);
    document.addEventListener("click", handleClick);
    return () => {
      el.removeEventListener("contextmenu", handleContextMenu);
      document.removeEventListener("click", handleClick);
    };
  }, [containerRef, handleContextMenu, handleClick]);

  if (!visible) return null;

  const handleAction = (type: "discussion" | "refinement") => {
    import("@/store/sessionStore.ts").then(({ useSessionStore }) => {
      const store = useSessionStore.getState();
      store.createSubsession(
        sessionId, type, selectedText,
        type === "discussion"
          ? "Discuss: " + selectedText.slice(0, 40)
          : "Refine selection"
      );
    }).catch(console.error);
    setVisible(false);
  };

  return (
    <div className="subsession-context-menu" style={{ position: "fixed", left: position.x, top: position.y, zIndex: 1000 }}>
      <div className="context-menu-label">Selected text</div>
      <button className="context-menu-item" onClick={() => handleAction("discussion")}>
        Discuss in subsession
      </button>
      <button className="context-menu-item" onClick={() => handleAction("refinement")}>
        Refine in subsession
      </button>
    </div>
  );
}
