import { useUiStore } from "@/store/uiStore.ts";
import { modLabel } from "@/utils/platform.ts";

interface PanelCollapseButtonProps {
  side: "left" | "right";
  shortcut: string;
}

export function PanelCollapseButton({ side, shortcut }: PanelCollapseButtonProps) {
  const toggleLeftPanel = useUiStore((s) => s.toggleLeftPanel);
  const toggleRightPanel = useUiStore((s) => s.toggleRightPanel);
  const onClick = side === "left" ? toggleLeftPanel : toggleRightPanel;
  // U+25C0 ◀ (text triangle) for left; U+25BA ► (pointer, no emoji variant) for right.
  const arrow = side === "left" ? "◀" : "►";
  const className =
    side === "left" ? "collapse-btn collapse-btn--push-right" : "collapse-btn";

  return (
    <button
      className={className}
      onClick={onClick}
      title={`Hide panel (${modLabel(shortcut)})`}
      aria-label="Hide panel"
    >
      {arrow}
    </button>
  );
}
