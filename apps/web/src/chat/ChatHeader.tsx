import type { SessionStats } from "@thinkrail/contracts";
import { Sparkles } from "lucide-react";
import type { ReactNode } from "react";
import { SessionStatsBar } from "./SessionStatsBar";

/** The chat tab's slim top bar: an optional left slot (the plan strip), extension status + token/cost
 *  stats, and the Skills manager trigger. */
export function ChatHeader({
	stats,
	statusEntries,
	left,
	onOpenSkills,
}: {
	stats: SessionStats | null;
	statusEntries: [string, string][];
	left?: ReactNode;
	/** Opens the workspace Skills manager; omitted when the owning project can't be resolved yet. */
	onOpenSkills?: () => void;
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
				{onOpenSkills ? (
					<button
						type="button"
						data-testid="open-skills"
						onClick={onOpenSkills}
						title="Skills"
						className="flex shrink-0 items-center gap-xs rounded-[var(--radius-sm)] px-sm py-0.5 text-muted text-xs outline-none transition-colors hover:bg-hover hover:text-text focus-visible:ring-2 focus-visible:ring-primary"
					>
						<Sparkles className="size-3.5" />
						Skills
					</button>
				) : null}
			</div>
		</div>
	);
}
