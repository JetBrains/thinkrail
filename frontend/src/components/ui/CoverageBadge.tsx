import type { MouseEvent } from "react";

interface CoverageBadgeProps {
  done: number;
  total: number;
  /** Tree row whose task card is expanded (uses the expanded style). */
  expanded?: boolean;
  onClick?: (e: MouseEvent) => void;
}

/**
 * The task-coverage pill from the spec tree: an icon + `done/total`, colored by
 * completion (none → in-progress → all-done), or an expanded state.
 */
export function CoverageBadge({ done, total, expanded, onClick }: CoverageBadgeProps) {
  const cls = expanded
    ? "st-task-pill-expanded"
    : done === total
      ? "st-task-pill-alldone"
      : done > 0
        ? "st-task-pill-progress"
        : "st-task-pill-none";
  const icon = done === total ? "✓" : done > 0 ? "◑" : "○";
  return (
    <span className={`st-task-pill ${cls}`} onClick={onClick}>
      {icon} {done}/{total}
    </span>
  );
}
