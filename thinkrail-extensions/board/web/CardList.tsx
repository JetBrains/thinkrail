import { useT } from "@thinkrail/locales/react";
import { ToggleSegment } from "@thinkrail/ui/toggle-segment";
import {
	type AttemptLive,
	agentBadge,
	type BoardView,
	type Card,
	type ListSort,
	latestLive,
	sortCards,
} from "./api";
import { AgentBadgeChip, PlanProgress, PrChip } from "./CardParts";
import { columnTitle } from "./labels";

const HEADER = "px-8 py-4 text-left tr-text-eyebrow text-text-muted";
const CELL = "px-8 py-4 align-top";

export function CardList({
	view,
	sort,
	onSort,
	onOpen,
}: {
	view: BoardView;
	sort: ListSort;
	onSort: (sort: ListSort) => void;
	onOpen: (card: Card) => void;
}) {
	const t = useT();
	const cards = sortCards(view, sort);
	return (
		<div data-testid="board-list" className="flex min-h-0 flex-1 flex-col">
			<div className="flex shrink-0 items-center gap-4 px-8 py-4">
				<span className="tr-text-metadata text-text-muted">{t("board.list.sort")}</span>
				<ToggleSegment
					testid="board-sort-column"
					label={t("board.list.sortColumn")}
					active={sort === "column"}
					onClick={() => onSort("column")}
				/>
				<ToggleSegment
					testid="board-sort-rank"
					label={t("board.list.sortRank")}
					active={sort === "rank"}
					onClick={() => onSort("rank")}
				/>
			</div>
			<div className="min-h-0 flex-1 overflow-auto">
				<table className="w-full border-collapse">
					<thead className="sticky top-0 bg-container-sidebar-bg">
						<tr>
							<th className={HEADER}>{t("board.list.id")}</th>
							<th className={HEADER}>{t("board.list.title")}</th>
							<th className={HEADER}>{t("board.list.column")}</th>
							<th className={HEADER}>{t("board.list.size")}</th>
							<th className={HEADER}>{t("board.list.agent")}</th>
							<th className={HEADER}>{t("board.list.plan")}</th>
							<th className={HEADER}>{t("board.list.pr")}</th>
						</tr>
					</thead>
					<tbody>
						{cards.map((card) => {
							const live: AttemptLive | undefined = latestLive(card);
							return (
								<tr
									key={card.id}
									data-testid="board-list-row"
									data-card-id={card.id}
									className="border-border-muted border-t hover:bg-control-bg-hovered"
								>
									<td className={`${CELL} tr-code-text-small text-text-muted`}>{card.id}</td>
									<td className={CELL}>
										<button
											type="button"
											data-testid="board-list-open"
											className="rounded-xs text-left tr-text-ui text-text-default hover:underline focus-visible:focus-ring"
											onClick={() => onOpen(card)}
										>
											{card.title}
										</button>
									</td>
									<td className={`${CELL} tr-text-metadata text-text-muted`}>
										{columnTitle(t, card.column)}
									</td>
									<td className={`${CELL} tr-text-metadata text-text-muted`}>{card.size ?? ""}</td>
									<td className={CELL}>
										<AgentBadgeChip badge={agentBadge(card)} />
									</td>
									<td className={CELL}>
										<PlanProgress plan={live?.open ? live.plan : null} />
									</td>
									<td className={CELL}>
										<PrChip pr={live?.open ? live.pr : null} />
									</td>
								</tr>
							);
						})}
					</tbody>
				</table>
			</div>
		</div>
	);
}
