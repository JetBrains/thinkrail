import { RiExternalLinkLine } from "@remixicon/react";
import type { PanelHost } from "@thinkrail/extension-api/web";
import { useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import { ToggleSegment } from "@thinkrail/ui/toggle-segment";
import { useId, useState } from "react";
import { agentBadge, type Card } from "./api";
import { AgentBadgeChip, FIELD } from "./CardParts";
import { CARD_TAB_LABELS, WORKFLOW_LABELS } from "./labels";

export type CardTab = "details" | "chat" | "review" | "activity";

export const CARD_TABS: readonly CardTab[] = ["details", "chat", "review", "activity"];

/** The tab a card opens on: its chat while the agent waits for the human or failed, else its details. */
export function defaultCardTab(card: Pick<Card, "live">): CardTab {
	const badge = agentBadge(card);
	return badge === "waiting" || badge === "failed" ? "chat" : "details";
}

export interface CardChatChoice {
	index: number;
	workspaceId: string;
	sessionId: string;
}

/** The attempts whose workspace is open, each a chat to show, newest last. */
export function cardChats(card: Pick<Card, "attempts" | "live">): CardChatChoice[] {
	return card.attempts.flatMap((_attempt, index) => {
		const live = card.live[index];
		return live?.open ? [{ index, workspaceId: live.workspaceId, sessionId: live.sessionId }] : [];
	});
}

export function CardTabBar({ tab, onTab }: { tab: CardTab; onTab: (tab: CardTab) => void }) {
	const t = useT();
	return (
		<div
			data-testid="board-card-tabs"
			className="flex shrink-0 items-center gap-2 border-border-muted border-b px-8 py-2"
		>
			{CARD_TABS.map((candidate) => (
				<ToggleSegment
					key={candidate}
					testid={`board-card-tab-${candidate}`}
					label={t(CARD_TAB_LABELS[candidate])}
					active={tab === candidate}
					onClick={() => onTab(candidate)}
				/>
			))}
		</div>
	);
}

/** The card's attempt chat, live and answerable here (`PanelHost.renderChat`); a picker when several are open. */
export function CardChat({
	host,
	projectId,
	card,
}: {
	host: PanelHost;
	projectId: string;
	card: Card;
}) {
	const t = useT();
	const id = useId();
	const chats = cardChats(card);
	const [picked, setPicked] = useState<string | null>(null);
	const chosen = chats.find((chat) => chat.sessionId === picked) ?? chats.at(-1);
	if (!chosen) {
		return (
			<p data-testid="board-card-chat-none" className="p-12 tr-text-metadata text-text-subtle">
				{card.attempts.length === 0 ? t("board.card.chat.none") : t("board.card.chat.closed")}
			</p>
		);
	}
	const latest = chosen === chats.at(-1) && chosen.index === card.attempts.length - 1;
	return (
		<div
			data-testid="board-card-chat"
			data-session-id={chosen.sessionId}
			className="flex min-h-0 flex-1 flex-col"
		>
			<div className="flex shrink-0 flex-wrap items-center gap-8 border-border-muted border-b px-8 py-4">
				{latest ? <AgentBadgeChip badge={agentBadge(card)} /> : null}
				{chats.length > 1 ? (
					<label htmlFor={`${id}-attempt`} className="flex items-center gap-4">
						<span className="tr-text-metadata text-text-muted">{t("board.card.chat.attempt")}</span>
						<select
							id={`${id}-attempt`}
							data-testid="board-card-chat-attempt"
							value={chosen.sessionId}
							onChange={(event) => setPicked(event.currentTarget.value)}
							className={FIELD}
						>
							{chats.map((chat) => {
								const attempt = card.attempts[chat.index];
								return (
									<option key={chat.sessionId} value={chat.sessionId}>
										{attempt
											? `${t(WORKFLOW_LABELS[attempt.workflow])} · ${new Date(attempt.startedAt).toLocaleString()}`
											: chat.sessionId}
									</option>
								);
							})}
						</select>
					</label>
				) : null}
				<Button
					variant="ghost"
					size="s"
					iconLeft={RiExternalLinkLine}
					data-testid="board-card-chat-workspace"
					className="ml-auto"
					onClick={() =>
						host.openWorkspace({
							workspaceId: chosen.workspaceId,
							projectId,
							sessionId: chosen.sessionId,
						})
					}
				>
					{t("board.attempts.openWorkspace")}
				</Button>
			</div>
			<div className="min-h-0 flex-1">
				{host.renderChat({ workspaceId: chosen.workspaceId, sessionId: chosen.sessionId })}
			</div>
		</div>
	);
}
