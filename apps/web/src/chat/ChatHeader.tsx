import type { SessionStats } from "@thinkrail/contracts";
import type { ReactNode } from "react";
import { SessionStatsBar } from "./SessionStatsBar";

/** The chat tab's slim top bar: an optional left slot (the plan strip) + extension status + token/cost stats. */
export function ChatHeader({
	stats,
	statusEntries,
	left,
}: {
	stats: SessionStats | null;
	statusEntries: [string, string][];
	left?: ReactNode;
}) {
	return (
		<div className="flex min-h-9 shrink-0 items-center gap-md border-border2 border-b bg-bg-dark px-sm py-xs">
			<div className="flex min-w-0 flex-1 items-center">{left}</div>
			<div className="flex shrink-0 flex-wrap items-center justify-end gap-md">
				{statusEntries.map(([key, text]) => (
					<span key={key} className="text-muted text-xs">
						{text}
					</span>
				))}
				<SessionStatsBar stats={stats} />
			</div>
		</div>
	);
}
