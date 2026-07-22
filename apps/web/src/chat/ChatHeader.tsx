import type { SessionStats } from "@thinkrail/contracts";
import { BookOpen } from "lucide-react";
import type { ReactNode } from "react";
import { SessionStatsBar } from "./SessionStatsBar";

/** The chat tab's slim top bar: an optional left slot (the plan strip), extension status + token/cost
 *  stats, and the Skills manager trigger. */
export function ChatHeader({
	stats,
	statusEntries,
	left,
	onOpenSkills,
	skillsStale,
}: {
	stats: SessionStats | null;
	statusEntries: [string, string][];
	left?: ReactNode;
	/** Opens the workspace Skills manager; omitted when the owning project can't be resolved yet. */
	onOpenSkills?: () => void;
	/** The worktree's skills changed on disk since this session loaded — badge the trigger. */
	skillsStale?: boolean;
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
						data-stale={skillsStale ? "true" : undefined}
						onClick={onOpenSkills}
						title={skillsStale ? "Skills changed on disk — reload" : "Skills"}
						className="flex shrink-0 items-center gap-xs rounded-[var(--radius-sm)] px-sm py-0.5 text-muted text-xs outline-none transition-colors hover:bg-hover hover:text-text focus-visible:ring-2 focus-visible:ring-primary"
					>
						<BookOpen className="size-3.5" />
						Skills
						{skillsStale ? <span className="size-1.5 rounded-full bg-gold" aria-hidden /> : null}
					</button>
				) : null}
			</div>
		</div>
	);
}
