import { RiFlag2Line, RiPushpinFill } from "@remixicon/react";
import type { PanelHost } from "@thinkrail/extension-api/web";
import { useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import { useId } from "react";
import type { Card } from "./api";
import { FIELD } from "./CardParts";
import { dayText } from "./labels";
import {
	addInitiativeCards,
	assignCard,
	initiativePeekEntry,
	loadRoadmap,
	type RoadmapView,
	removeInitiativeCards,
	unpinCard,
} from "./roadmapApi";
import { useBoardChanged, useHostQuery } from "./useHostQuery";

/**
 * Moves a card to another initiative of its board, or none: off every initiative that lists it directly,
 * onto the picked one. A card in a roadmap project with an initiative follows its project instead.
 */
export async function setCardInitiative(
	host: Pick<PanelHost, "query">,
	view: Pick<RoadmapView, "projectId" | "initiatives">,
	cardId: string,
	initiativeId: string | null,
): Promise<void> {
	for (const listing of view.initiatives)
		if (listing.id !== initiativeId && listing.cardIds.includes(cardId))
			await removeInitiativeCards(host, view.projectId, listing.id, [cardId]);
	const target = view.initiatives.find((initiative) => initiative.id === initiativeId);
	if (target && !target.cardIds.includes(cardId))
		await addInitiativeCards(host, view.projectId, target.id, [cardId]);
}

/**
 * The card's place on the roadmap: initiative, project and milestone, with its initiative's outcome, and
 * its planned start when the step graph pinned one.
 */
export function CardRoadmap({
	host,
	projectId,
	card,
	onWrite,
}: {
	host: PanelHost;
	projectId: string;
	card: Card;
	onWrite: (run: () => Promise<unknown>) => void;
}) {
	const t = useT();
	const id = useId();
	const roadmap = useHostQuery(`roadmap:${projectId}`, (signal) =>
		loadRoadmap(host, projectId, signal),
	);
	useBoardChanged(host, projectId, roadmap.reload);
	const view = roadmap.state.kind === "ready" ? roadmap.state.value : null;
	const project = view?.projects.find((candidate) => candidate.id === card.roadmapProjectId);
	const viaProject = project?.initiativeId
		? view?.initiatives.find((initiative) => initiative.id === project.initiativeId)
		: undefined;
	const served = card.initiative;
	const local = served && served.projectId === projectId ? served.id : "";
	const write = (run: () => Promise<unknown>) =>
		onWrite(async () => {
			await run();
			roadmap.reload();
		});
	return (
		<div data-testid="board-card-roadmap" className="flex flex-col gap-8">
			{served ? (
				<div data-testid="board-card-initiative-outcome" className="flex flex-col gap-2">
					<button
						type="button"
						data-testid="board-card-initiative-open"
						className="flex min-w-0 items-center gap-4 self-start rounded-xs text-left tr-text-emphasis text-text-default underline-offset-2 hover:underline focus-visible:focus-ring"
						onClick={() => host.peek(initiativePeekEntry(served.projectId, served))}
					>
						<RiFlag2Line aria-hidden className="size-12 shrink-0 text-text-muted" />
						<span className="truncate">
							{t("board.roadmap.card.heading", { id: served.id, title: served.title })}
						</span>
					</button>
					<p className="tr-text-ui text-text-muted wrap-anywhere">
						{served.outcome || t("board.roadmap.card.noOutcome")}
					</p>
				</div>
			) : null}
			<div className="flex flex-wrap items-end gap-8">
				<label htmlFor={`${id}-initiative`} className="flex min-w-0 flex-col gap-2">
					<span className="tr-text-metadata text-text-muted">
						{t("board.roadmap.card.initiative")}
					</span>
					<select
						id={`${id}-initiative`}
						data-testid="board-card-initiative-select"
						value={viaProject ? viaProject.id : local}
						disabled={!view || !!viaProject}
						onChange={(event) => {
							const picked = event.currentTarget.value || null;
							if (view) write(() => setCardInitiative(host, view, card.id, picked));
						}}
						className={FIELD}
					>
						<option value="">{t("board.roadmap.card.noInitiative")}</option>
						{(view?.initiatives ?? []).map((initiative) => (
							<option key={initiative.id} value={initiative.id}>
								{t("board.roadmap.card.option", {
									indent: "\u2002".repeat(initiative.depth),
									id: initiative.id,
									title: initiative.title,
								})}
							</option>
						))}
					</select>
				</label>
				<label htmlFor={`${id}-project`} className="flex min-w-0 flex-col gap-2">
					<span className="tr-text-metadata text-text-muted">
						{t("board.roadmap.card.project")}
					</span>
					<select
						id={`${id}-project`}
						data-testid="board-card-project-select"
						value={card.roadmapProjectId ?? ""}
						disabled={!view}
						onChange={(event) => {
							const roadmapProjectId = event.currentTarget.value || null;
							write(() => assignCard(host, card.id, { roadmapProjectId }));
						}}
						className={FIELD}
					>
						<option value="">{t("board.roadmap.card.noProject")}</option>
						{(view?.projects ?? []).map((candidate) => (
							<option key={candidate.id} value={candidate.id}>
								{t("board.card.blockOption", { id: candidate.id, title: candidate.title })}
							</option>
						))}
					</select>
				</label>
				<label htmlFor={`${id}-milestone`} className="flex min-w-0 flex-col gap-2">
					<span className="tr-text-metadata text-text-muted">
						{t("board.roadmap.card.milestone")}
					</span>
					<select
						id={`${id}-milestone`}
						data-testid="board-card-milestone-select"
						value={card.milestoneId ?? ""}
						disabled={!project || project.milestones.length === 0}
						onChange={(event) => {
							const milestoneId = event.currentTarget.value || null;
							write(() => assignCard(host, card.id, { milestoneId }));
						}}
						className={FIELD}
					>
						<option value="">{t("board.roadmap.card.noMilestone")}</option>
						{(project?.milestones ?? []).map((milestone) => (
							<option key={milestone.id} value={milestone.id}>
								{milestone.title}
							</option>
						))}
					</select>
				</label>
			</div>
			{card.pinnedStart ? (
				<div
					data-testid="board-card-pinned"
					data-start={card.pinnedStart}
					className="flex flex-wrap items-center gap-4 tr-text-metadata text-text-muted"
				>
					<RiPushpinFill aria-hidden className="size-12 shrink-0" />
					<span>{t("board.roadmap.card.pinned", { date: dayText(card.pinnedStart) })}</span>
					<Button
						variant="ghost"
						size="s"
						data-testid="board-card-unpin"
						onClick={() => write(() => unpinCard(host, card.id))}
					>
						{t("board.roadmap.graph.unpin")}
					</Button>
				</div>
			) : null}
			{viaProject && project ? (
				<span className="tr-text-metadata text-text-subtle">
					{t("board.roadmap.card.viaProject", { project: project.title })}
				</span>
			) : served && served.projectId !== projectId ? (
				<span className="tr-text-metadata text-text-subtle">{t("board.roadmap.card.abroad")}</span>
			) : null}
		</div>
	);
}
