import type { SessionStats } from "@thinkrail/contracts";
import type { ReactNode } from "react";
import { SessionStatsBar } from "./SessionStatsBar";
import { SkillsButton } from "./SkillsButton";

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
					<SkillsButton onOpen={onOpenSkills} testId="open-skills" stale={skillsStale ?? false} />
				) : null}
			</div>
		</div>
	);
}
