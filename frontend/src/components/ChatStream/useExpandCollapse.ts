import { useEffect, useRef } from "react";

import { EVENT_PREFIX } from "@/constants/branding";

/** Expand/collapse DOM CustomEvent names. Dispatched by ChatStream, listened
 *  to here — shared so the two sides can't drift. */
export const EXPAND_ALL_EVENT = `${EVENT_PREFIX}expandAll`;
export const COLLAPSE_EVENTS_EVENT = `${EVENT_PREFIX}collapseEvents`;
export const COLLAPSE_ALL_EVENT = `${EVENT_PREFIX}collapseAll`;

/**
 * Hook to listen for expand/collapse custom events.
 *
 * Three events exist:
 * - {@link EXPAND_ALL_EVENT} — expand everything
 * - {@link COLLAPSE_EVENTS_EVENT} — collapse tool cards, subagents (NOT visualizations)
 * - {@link COLLAPSE_ALL_EVENT} — collapse everything including visualizations
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

    document.addEventListener(EXPAND_ALL_EVENT, onExpand);
    document.addEventListener(COLLAPSE_ALL_EVENT, onCollapse);
    if (!isVisualization) {
      document.addEventListener(COLLAPSE_EVENTS_EVENT, onCollapse);
    }
    return () => {
      document.removeEventListener(EXPAND_ALL_EVENT, onExpand);
      document.removeEventListener(COLLAPSE_ALL_EVENT, onCollapse);
      if (!isVisualization) {
        document.removeEventListener(COLLAPSE_EVENTS_EVENT, onCollapse);
      }
    };
  }, [setExpanded, isVisualization]);

  return elRef;
}
