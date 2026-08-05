/**
 * The `+N −M` diff-count badge — one visual, shared by the project rail's per-worktree stats and the
 * Changes tree's per-file / per-folder counts. Renders nothing when there's nothing added or removed.
 * Layout-only extras (e.g. the rail's `group-hover:hidden`) come in via `className`.
 * `muted` selects the 40% feedback variants (the project rail's dimmed counters); default keeps the
 * full-intensity feedback colors (the Changes list/tree counts).
 */
export function DiffStatBadge({
	added,
	removed,
	className,
	muted = false,
}: {
	added: number;
	removed: number;
	className?: string;
	muted?: boolean;
}) {
	if (added <= 0 && removed <= 0) return null;
	return (
		<span className={`shrink-0 tr-text-metadata tabular-nums ${className ?? ""}`}>
			<span className={muted ? "text-feedback-success-muted" : "text-feedback-success"}>
				+{added}
			</span>{" "}
			<span className={muted ? "text-feedback-error-muted" : "text-feedback-error"}>
				−{removed}
			</span>
		</span>
	);
}
