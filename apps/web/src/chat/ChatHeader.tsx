import type { SessionStats } from "@thinkrail-pi/contracts";
import { SessionStatsBar } from "./SessionStatsBar";

/** The chat tab's slim top bar: extension status + token/cost stats. */
export function ChatHeader({
	stats,
	statusEntries,
}: {
	stats: SessionStats | null;
	statusEntries: [string, string][];
}) {
	return (
		<div className="flex min-h-9 shrink-0 flex-wrap items-center justify-end gap-md border-border2 border-b bg-bg-dark px-sm py-xs">
			{statusEntries.map(([key, text]) => (
				<span key={key} className="text-muted text-xs">
					{text}
				</span>
			))}
			<SessionStatsBar stats={stats} />
		</div>
	);
}
