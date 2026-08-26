// Tiny shared display formatters for pi-owned numbers (tokens, cost, wall-clock). One home so the
// stats bar, the round-end divider, and the subagent cards can never format the same quantity three
// ways. Pure, no React.

/** "982" / "30.4k" / "1.2M" from a token count. */
export function formatTokens(n: number): string {
	if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
	if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
	return String(n);
}

/** "$0.42" for cents-and-up, "$0.0042" below (a sub-cent cost must not render as $0.00). */
export function formatCost(n: number): string {
	return n >= 0.01 ? `$${n.toFixed(2)}` : `$${n.toFixed(4)}`;
}

/** "45s" / "1m 12s" from a millisecond span. */
export function formatElapsed(ms: number): string {
	const totalSec = Math.round(ms / 1000);
	const m = Math.floor(totalSec / 60);
	const s = totalSec % 60;
	return m > 0 ? `${m}m ${s}s` : `${s}s`;
}
