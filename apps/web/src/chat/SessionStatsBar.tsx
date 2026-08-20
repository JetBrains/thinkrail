import type { ContextUsage, SessionStats } from "@thinkrail/contracts";

export function formatTokens(count: number): string {
	if (count < 1_000) return count.toString();
	if (count < 10_000) return `${(count / 1_000).toFixed(1)}k`;
	if (count < 1_000_000) return `${Math.round(count / 1_000)}k`;
	if (count < 10_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
	return `${Math.round(count / 1_000_000)}M`;
}

export function usageParts(stats: SessionStats): string[] {
	const parts: string[] = [];
	if (stats.tokens.input) parts.push(`↑${formatTokens(stats.tokens.input)}`);
	if (stats.tokens.output) parts.push(`↓${formatTokens(stats.tokens.output)}`);
	if (stats.tokens.cacheRead) parts.push(`R${formatTokens(stats.tokens.cacheRead)}`);
	if (stats.tokens.cacheWrite) parts.push(`W${formatTokens(stats.tokens.cacheWrite)}`);
	if (stats.cost) parts.push(`$${stats.cost.toFixed(3)}`);
	return parts;
}

export function contextPart(usage: ContextUsage): { bar: string; text: string } {
	const filled =
		usage.percent === null ? 0 : Math.round(Math.min(100, Math.max(0, usage.percent)) / 20);
	const contextWindow = formatTokens(usage.contextWindow);
	return {
		bar: `${"▰".repeat(filled)}${"▱".repeat(5 - filled)}`,
		text:
			usage.percent === null
				? `?/${contextWindow}`
				: `${usage.percent.toFixed(1)}%/${contextWindow}`,
	};
}

export function SessionStatsBar({ stats }: { stats: SessionStats | null }) {
	if (!stats) return null;
	const parts = usageParts(stats);
	const context = stats.contextUsage ? contextPart(stats.contextUsage) : null;
	if (parts.length === 0 && !context) return null;

	return (
		<div
			data-testid="session-stats"
			className="flex shrink-0 flex-nowrap items-center justify-end gap-x-xs text-text-muted tr-text-metadata"
			title="Cumulative usage: ↑ input · ↓ output · R cache read · W cache write"
		>
			{parts.map((part, index) => (
				<span key={part} className="flex items-center gap-xs whitespace-nowrap">
					{index > 0 ? <span aria-hidden="true">·</span> : null}
					{part}
				</span>
			))}
			{context ? (
				<span className="flex items-center gap-xs whitespace-nowrap" title="Context window used">
					{parts.length > 0 ? <span aria-hidden="true">·</span> : null}
					<span aria-hidden="true" className="text-primary">
						{context.bar}
					</span>
					{context.text}
				</span>
			) : null}
		</div>
	);
}
