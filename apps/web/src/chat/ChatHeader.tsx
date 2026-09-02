import type { SessionStats } from "@thinkrail/contracts";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { SessionStatsBar } from "./SessionStatsBar";
import { SkillsButton } from "./SkillsButton";

export function ChatHeader({
	stats,
	statusEntries,
	left,
	onOpenSkills,
	skillsStale,
	slot,
}: {
	stats: SessionStats | null;
	statusEntries: [string, string][];
	left?: ReactNode;
	onOpenSkills?: () => void;
	skillsStale?: boolean;
	slot?: HTMLElement | null;
}) {
	const content = (
		<>
			<div className="flex min-w-0 flex-1 items-center gap-8 overflow-clip">{left}</div>
			<div className="flex min-w-0 items-center justify-end gap-12 overflow-clip">
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
		</>
	);
	if (slot) {
		return createPortal(
			<div
				data-testid="chat-toolbar"
				className="flex h-full min-w-0 flex-1 items-center gap-12 overflow-clip px-8"
			>
				{content}
			</div>,
			slot,
		);
	}
	return (
		<div
			data-testid="chat-toolbar"
			className="flex h-panel-header-row shrink-0 items-center gap-12 overflow-clip border-border-muted border-b bg-container-workspace-bg px-12"
		>
			{content}
		</div>
	);
}
