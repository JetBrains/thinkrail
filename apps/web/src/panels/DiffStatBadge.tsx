/**
 * The Changes views' `+N −M` diff-count badge, shared by flat file rows and the tree's per-file /
 * per-folder counts. Renders nothing when there's nothing added or removed; layout-only extras come in
 * via `className`.
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
		<span className={`shrink-0 tr-text-metadata tabular-nums ${className ?? ""}`}>
			<span className="text-feedback-success">+{added}</span>{" "}
			<span className="text-feedback-error">−{removed}</span>
		</span>
	);
}
