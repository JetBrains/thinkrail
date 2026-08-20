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
