import { useDraggable } from "@dnd-kit/core";
import { RiPlayLine } from "@remixicon/react";
import { useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import { cn } from "@thinkrail/ui/utils";
import type { KeyboardEvent } from "react";
import { type Card, canStart } from "./api";
import { CardMeta, LiveLine } from "./CardParts";

export interface CardActions {
	open: (card: Card) => void;
	/** Enter the workspace of its open attempt. */
	enter: (card: Card) => void;
	start: (card: Card) => void;
	keyDown: (card: Card, event: KeyboardEvent<HTMLElement>) => void;
}

export function CardTile({
	card,
	actions,
	starting,
	compact = false,
}: {
	card: Card;
	actions: CardActions;
	starting: boolean;
	compact?: boolean;
}) {
	const t = useT();
	const { setNodeRef, listeners, isDragging } = useDraggable({ id: card.id });
	return (
		<li
			ref={setNodeRef}
			data-testid="board-card"
			data-card-id={card.id}
			data-column={card.column}
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
				<LiveLine card={card} />
				{card.blockedBy.length > 0 ? (
					<span className="tr-text-metadata text-feedback-warning">
						{t("board.card.blockedBy", { ids: card.blockedBy.join(", ") })}
					</span>
				) : null}
			</button>
			{canStart(card) ? (
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
