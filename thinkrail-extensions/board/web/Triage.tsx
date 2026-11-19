import {
	RiArrowDownSLine,
	RiArrowRightSLine,
	RiCheckDoubleLine,
	RiCheckLine,
} from "@remixicon/react";
import { useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import { cn } from "@thinkrail/ui/utils";
import { useState } from "react";
import { type BoardLayout, type BoardView, type Card, type TriageGroup, triageGroups } from "./api";
import { CardMeta } from "./CardParts";

export interface TriageActions {
	accept: (cardIds: string[]) => void;
	dismiss: (cardIds: string[]) => void;
	open: (card: Card) => void;
}

function TriageCard({ card, actions }: { card: Card; actions: TriageActions }) {
	const t = useT();
	return (
		<li
			data-testid="board-triage-card"
			data-card-id={card.id}
			className="flex min-w-0 flex-col gap-4 rounded-sm border border-border-muted bg-container-elevated-bg p-8"
		>
			<button
				type="button"
				aria-label={t("board.card.open", { id: card.id, title: card.title })}
				className="flex min-w-0 flex-col gap-4 rounded-xs text-left focus-visible:focus-ring"
				onClick={() => actions.open(card)}
			>
				<CardMeta card={card} />
				<span className="line-clamp-2 tr-text-ui text-text-default">{card.title}</span>
			</button>
			<Button
				variant="ghost"
				size="s"
				iconLeft={RiCheckLine}
				data-testid="board-triage-accept-card"
				className="self-start"
				onClick={() => actions.accept([card.id])}
			>
				{t("board.triage.accept")}
			</Button>
		</li>
	);
}

function TriageGroupView({ group, actions }: { group: TriageGroup; actions: TriageActions }) {
	const t = useT();
	const [dismissing, setDismissing] = useState(false);
	const ids = group.cards.map((card) => card.id);
	return (
		<section
			data-testid="board-triage-group"
			data-origin={group.key || undefined}
			className="flex min-w-0 flex-col gap-4"
		>
			<h4 className="flex min-w-0 items-center gap-4 px-4 tr-text-metadata text-text-muted">
				<span className="min-w-0 truncate">
					{group.cardId
						? t("board.triage.fromCard", { id: group.cardId })
						: group.key
							? t("board.triage.fromChat")
							: t("board.triage.fromNowhere")}
				</span>
				<span className="tabular-nums text-text-subtle">{group.cards.length}</span>
			</h4>
			{dismissing ? (
				<span className="flex flex-wrap items-center gap-4 px-4">
					<span className="tr-text-metadata text-text-muted">
						{t("board.triage.dismissConfirm", { count: ids.length })}
					</span>
					<Button
						variant="destructive"
						size="s"
						data-testid="board-triage-dismiss-confirm"
						onClick={() => {
							setDismissing(false);
							actions.dismiss(ids);
						}}
					>
						{t("board.triage.dismiss")}
					</Button>
					<Button variant="ghost" size="s" onClick={() => setDismissing(false)}>
						{t("board.triage.keep")}
					</Button>
				</span>
			) : (
				<span className="flex flex-wrap items-center gap-4 px-4">
					<Button
						variant="soft-primary"
						size="s"
						iconLeft={RiCheckDoubleLine}
						data-testid="board-triage-accept-all"
						onClick={() => actions.accept(ids)}
					>
						{t("board.triage.acceptAll")}
					</Button>
					<Button
						variant="ghost"
						size="s"
						data-testid="board-triage-dismiss"
						onClick={() => setDismissing(true)}
					>
						{t("board.triage.dismiss")}
					</Button>
				</span>
			)}
			<ul className="flex flex-col gap-4">
				{group.cards.map((card) => (
					<TriageCard key={card.id} card={card} actions={actions} />
				))}
			</ul>
		</section>
	);
}

/**
 * Agent-filed cards waiting for acceptance, grouped by the chat that filed them, so a decomposition is
 * accepted or dismissed as a whole. Collapsed by default; absent while Triage is empty.
 */
export function TriageLane({
	view,
	layout,
	actions,
}: {
	view: Pick<BoardView, "cards">;
	layout: BoardLayout;
	actions: TriageActions;
}) {
	const t = useT();
	const [expanded, setExpanded] = useState(false);
	const groups = triageGroups(view);
	const count = groups.reduce((sum, group) => sum + group.cards.length, 0);
	if (count === 0) return null;
	const Chevron = expanded ? RiArrowDownSLine : RiArrowRightSLine;
	return (
		<section
			data-testid="board-triage"
			data-expanded={expanded || undefined}
			aria-label={t("board.column.triage")}
			className={cn(
				"flex min-h-0 shrink-0 flex-col gap-8 rounded-sm border border-border-muted border-dashed p-4",
				layout === "columns" && expanded && "w-240 overflow-auto",
			)}
		>
			<Button
				variant="ghost"
				size="s"
				iconLeft={Chevron}
				data-testid="board-triage-toggle"
				aria-expanded={expanded}
				className="self-start"
				onClick={() => setExpanded((value) => !value)}
			>
				{t("board.triage.toggle", { n: count })}
			</Button>
			{expanded
				? groups.map((group) => <TriageGroupView key={group.key} group={group} actions={actions} />)
				: null}
		</section>
	);
}
