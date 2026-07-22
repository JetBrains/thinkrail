/**
 * The `+N −M` diff-count badge — one visual, shared by the project rail's per-worktree stats and the
 * Changes tree's per-file / per-folder counts. Renders nothing when there's nothing added or removed.
 * Layout-only extras (e.g. the rail's `group-hover:hidden`) come in via `className`.
 */
export function DiffStatBadge({
	added,
	removed,
	className,
}: {
	added: number;
	removed: number;
	className?: string;
}) {
	if (added <= 0 && removed <= 0) return null;
	return (
		<span className={`shrink-0 text-xs tabular-nums ${className ?? ""}`}>
			<span className="text-green">+{added}</span> <span className="text-red">−{removed}</span>
		</span>
	);
}
