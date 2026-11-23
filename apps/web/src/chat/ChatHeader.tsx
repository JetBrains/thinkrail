import { RiArrowRightUpLine } from "@remixicon/react";
import type { SessionStats } from "@thinkrail/contracts";
import { Button } from "@thinkrail/ui/button";
import type { ComponentType, ReactNode } from "react";
import type { ChatAction, ChatActionTarget } from "@/lib";
import { SessionStatsBar } from "./SessionStatsBar";
import { SkillsButton } from "./SkillsButton";

export interface ChatHeaderLink {
	readonly id: string;
	readonly label: string;
	readonly onOpen: () => void;
	/** Set for a toggle of something shown beside the chat: whether it shows now. */
	readonly pressed?: boolean;
	readonly icon?: ComponentType<{ className?: string | undefined }>;
}

const NO_LINKS: readonly ChatHeaderLink[] = [];

/** The header's link per chat action; one that opens beside the chat is a toggle, pressed while its pane shows. */
export function chatHeaderLinks(
	actions: readonly ChatAction[],
	target: ChatActionTarget,
	pane: { readonly id: string; readonly onClose: () => void } | undefined,
): ChatHeaderLink[] {
	return actions.map(({ id, label, icon, run, pane: besideChat }) => {
		const open = () => run(target);
		if (!besideChat) return { id, label, onOpen: open };
		const pressed = pane?.id === id;
		return { id, label, icon, pressed, onOpen: pressed ? pane.onClose : open };
	});
}

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
				{links.map((link) =>
					link.pressed === undefined ? (
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
					) : (
						<Button
							key={link.id}
							variant="ghost"
							size="m"
							{...(link.icon ? { iconLeft: link.icon } : {})}
							selected={link.pressed}
							aria-pressed={link.pressed}
							data-testid="chat-header-toggle"
							data-action={link.id}
							onClick={link.onOpen}
							className="shrink-0"
						>
							{link.label}
						</Button>
					),
				)}
			</div>
			{resources}
			{onOpenSkills ? (
				<SkillsButton onOpen={onOpenSkills} testId="open-skills" stale={skillsStale ?? false} />
			) : null}
		</div>
	);
}
