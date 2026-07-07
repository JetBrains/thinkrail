import type { SessionStats } from "@thinkrail/contracts";
import { cn } from "@/lib";

function formatTokens(n: number): string {
	if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
	if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
	return String(n);
}

function formatCost(n: number): string {
	return n >= 0.01 ? `$${n.toFixed(2)}` : `$${n.toFixed(4)}`;
}

// Context-bar fill in 10% steps — utility classes (no inline style) so the bar stays themeable.
const FILL = [
	"w-0",
	"w-[10%]",
	"w-[20%]",
	"w-[30%]",
	"w-[40%]",
	"w-1/2",
	"w-[60%]",
	"w-[70%]",
	"w-[80%]",
	"w-[90%]",
	"w-full",
] as const;

/** Token/cost + context-window usage (cheap win #3). Display only — `pi` owns the numbers. Props-driven. */
export function SessionStatsBar({ stats }: { stats: SessionStats | null }) {
	if (!stats) return null;
	const percent = stats.contextUsage?.percent ?? null;
	const bucket = percent === null ? null : Math.round(Math.min(100, Math.max(0, percent)) / 10);

	return (
		<div data-testid="session-stats" className="flex items-center gap-sm text-muted text-xs">
			<span title="Total tokens">{formatTokens(stats.tokens.total)} tok</span>
			<span title="Session cost">{formatCost(stats.cost)}</span>
			{percent !== null && bucket !== null ? (
				<span className="flex items-center gap-xs" title="Context window used">
					<span className="block h-1.5 w-16 overflow-hidden rounded-full bg-[var(--sunken)]">
						<span className={cn("block h-full rounded-full bg-primary", FILL[bucket])} />
					</span>
					{Math.round(percent)}%
				</span>
			) : null}
		</div>
	);
}
