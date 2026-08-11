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
		<div
			data-testid="chat-toolbar"
			className="flex h-panel-header-row shrink-0 items-center gap-md overflow-clip border-border-muted border-b bg-container-workspace-bg px-sm"
		>
			<div className="flex min-w-0 flex-1 items-center overflow-clip">{left}</div>
			<div className="flex min-w-0 items-center justify-end gap-md overflow-clip">
				{statusEntries.map(([key, text]) => (
					<span key={key} className="shrink-0 whitespace-nowrap text-text-muted tr-text-metadata">
						{text}
					</span>
				))}
				<SessionStatsBar stats={stats} />
			</div>
			{onOpenSkills ? (
				<SkillsButton onOpen={onOpenSkills} testId="open-skills" stale={skillsStale ?? false} />
			) : null}
		</div>
	);
}
