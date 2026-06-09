import { useUiStore } from "@/store/uiStore.ts";
import { modLabel } from "@/utils/platform.ts";

interface PanelCollapseButtonProps {
  shortcut: string;
}

/** Collapse toggle for the left panel. The right panel is always visible and
 *  has no collapse affordance. */
export function PanelCollapseButton({ shortcut }: PanelCollapseButtonProps) {
  const toggleLeftPanel = useUiStore((s) => s.toggleLeftPanel);

  return (
    <button
      className="collapse-btn collapse-btn--push-right"
      onClick={toggleLeftPanel}
      title={`Hide panel (${modLabel(shortcut)})`}
      aria-label="Hide panel"
    >
      {"◀"}
    </button>
  );
}
