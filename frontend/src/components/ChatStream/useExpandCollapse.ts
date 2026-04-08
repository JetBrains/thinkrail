import { useEffect, useRef } from "react";

/**
 * Hook to listen for expand/collapse custom events.
 *
 * Three events exist:
 * - `bonsai:expandAll` — expand everything
 * - `bonsai:collapseEvents` — collapse tool cards, subagents (NOT visualizations)
 * - `bonsai:collapseAll` — collapse everything including visualizations
 *
 * @param setExpanded - state setter for expand/collapse
 * @param isVisualization - if true, only listens to expandAll and collapseAll (not collapseEvents)
 */
export function useExpandCollapse(
  setExpanded: (expanded: boolean) => void,
  isVisualization = false,
): React.RefObject<HTMLDivElement | null> {
  const elRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onExpand = () => setExpanded(true);
    const onCollapse = () => setExpanded(false);

    document.addEventListener("bonsai:expandAll", onExpand);
    document.addEventListener("bonsai:collapseAll", onCollapse);
    if (!isVisualization) {
      document.addEventListener("bonsai:collapseEvents", onCollapse);
    }
    return () => {
      document.removeEventListener("bonsai:expandAll", onExpand);
      document.removeEventListener("bonsai:collapseAll", onCollapse);
      if (!isVisualization) {
        document.removeEventListener("bonsai:collapseEvents", onCollapse);
      }
    };
  }, [setExpanded, isVisualization]);

  return elRef;
}
