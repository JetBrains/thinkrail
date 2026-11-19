import { RiArrowRightUpLine } from "@remixicon/react";
import type { SessionStats } from "@thinkrail/contracts";
import type { ReactNode } from "react";
import { SessionStatsBar } from "./SessionStatsBar";
import { SkillsButton } from "./SkillsButton";

export interface ChatHeaderLink {
	readonly id: string;
	readonly label: string;
	readonly onOpen: () => void;
}

const NO_LINKS: readonly ChatHeaderLink[] = [];

export function ChatHeader({
	stats,
	statusEntries,
	links = NO_LINKS,
	resources,
	onOpenSkills,
	skillsStale,
}: {
	stats: SessionStats | null;
	statusEntries: [string, string][];
	links?: readonly ChatHeaderLink[];
	resources?: ReactNode;
	onOpenSkills?: () => void;
	skillsStale?: boolean;
}) {
	return (
		<div
			data-testid="chat-toolbar"
			className="flex h-panel-header-row shrink-0 items-center gap-12 overflow-clip border-border-muted border-b bg-container-workspace-bg px-12"
		>
			<div className="min-w-0 flex-1" />
			<div className="flex min-w-0 items-center justify-end gap-12 overflow-clip">
				{statusEntries.map(([key, text]) => (
					<span key={key} className="min-w-0 truncate text-text-muted tr-text-metadata">
						{text}
					</span>
				))}
				<SessionStatsBar stats={stats} />
				{links.map((link) => (
					<button
						key={link.id}
						type="button"
						data-testid="chat-header-link"
						data-action={link.id}
						onClick={link.onOpen}
						className="flex shrink-0 items-center gap-2 whitespace-nowrap rounded-sm text-primary tr-text-metadata underline-offset-2 hover:underline focus-visible:focus-ring"
					>
						{link.label}
						<RiArrowRightUpLine aria-hidden className="size-14 shrink-0" />
					</button>
				))}
			</div>
			{resources}
			{onOpenSkills ? (
				<SkillsButton onOpen={onOpenSkills} testId="open-skills" stale={skillsStale ?? false} />
			) : null}
		</div>
	);
}
