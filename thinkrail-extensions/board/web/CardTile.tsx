import { useDraggable } from "@dnd-kit/core";
import { RiInboxArchiveLine, RiPlayLine } from "@remixicon/react";
import { useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import { cn } from "@thinkrail/ui/utils";
import type { KeyboardEvent } from "react";
import { type Card, canAdopt, canStart } from "./api";
import {
	CardMeta,
	InitiativeChip,
	LiveLine,
	StartWarning,
	TaskSpecLine,
	TaskSpecStatus,
} from "./CardParts";

export interface CardActions {
	open: (card: Card) => void;
	/** Enter the workspace of its open attempt. */
	enter: (card: Card) => void;
	/** Starts the card; without `anyway`, a human-attention limit past its count asks first. */
	start: (card: Card, anyway?: boolean) => void;
	/** Stores an unbound workspace's task-spec card, bound to that workspace. */
	adopt: (card: Card) => void;
	cancelStart: () => void;
	keyDown: (card: Card, event: KeyboardEvent<HTMLElement>) => void;
}

export function CardTile({
	card,
	actions,
	starting,
	startWarning = null,
	compact = false,
}: {
	card: Card;
	actions: CardActions;
	/** Start or Adopt is running for this card. */
	starting: boolean;
	/** Start was pressed past a human-attention limit: the question to confirm. */
	startWarning?: string | null;
	compact?: boolean;
}) {
	const t = useT();
	const adoptable = canAdopt(card);
	const { setNodeRef, listeners, isDragging } = useDraggable({ id: card.id, disabled: adoptable });
	return (
		<li
			ref={setNodeRef}
			data-testid="board-card"
			data-card-id={card.id}
			data-column={card.column}
			data-source={card.source.kind}
			data-virtual={card.virtual || undefined}
			data-dragging={isDragging || undefined}
			className={cn(
				"group flex min-w-0 flex-col gap-4 rounded-sm border border-border-muted bg-container-elevated-bg p-8 hover:border-border-default data-[dragging]:opacity-60",
				compact && "py-4",
			)}
		>
			<button
				type="button"
				aria-label={t("board.card.open", { id: card.id, title: card.title })}
				data-testid="board-card-open"
				className="flex min-w-0 cursor-pointer flex-col gap-4 rounded-xs text-left focus-visible:focus-ring"
				{...listeners}
				onClick={() => actions.open(card)}
				onDoubleClick={() => actions.enter(card)}
				onKeyDown={(event) => actions.keyDown(card, event)}
			>
				<CardMeta card={card} />
				<span className={cn("tr-text-ui text-text-default", compact ? "truncate" : "line-clamp-3")}>
					{card.title}
				</span>
				<InitiativeChip card={card} />
				{adoptable ? (
					<span className="flex">
						<TaskSpecStatus status={card.taskSpecs[0]?.status ?? null} />
					</span>
				) : (
					<TaskSpecLine specs={card.taskSpecs} />
				)}
				<LiveLine card={card} />
				{card.blockedBy.length > 0 ? (
					<span className="tr-text-metadata text-feedback-warning">
						{t("board.card.blockedBy", { ids: card.blockedBy.join(", ") })}
					</span>
				) : null}
			</button>
			{startWarning ? (
				<StartWarning
					text={startWarning}
					onAnyway={() => actions.start(card, true)}
					onCancel={actions.cancelStart}
				/>
			) : adoptable ? (
				<Button
					variant="soft-primary"
					size="s"
					iconLeft={RiInboxArchiveLine}
					loading={starting}
					data-testid="board-card-adopt"
					className="self-start"
					onClick={() => actions.adopt(card)}
				>
					{t("board.card.adopt")}
				</Button>
			) : canStart(card) ? (
				<Button
					variant="soft-primary"
					size="s"
					iconLeft={RiPlayLine}
					loading={starting}
					data-testid="board-card-start"
					className="self-start"
					onClick={() => actions.start(card)}
				>
					{t("board.card.start")}
				</Button>
			) : null}
		</li>
	);
}
