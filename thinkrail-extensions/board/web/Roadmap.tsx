import {
	DndContext,
	type DragEndEvent,
	DragOverlay,
	type DragStartEvent,
	PointerSensor,
	pointerWithin,
	useDraggable,
	useDroppable,
	useSensor,
	useSensors,
} from "@dnd-kit/core";
import {
	RiAddLine,
	RiCheckLine,
	RiCloseLine,
	RiDeleteBinLine,
	RiDiscussLine,
	RiFileList3Line,
	RiForbidLine,
	RiTimerLine,
} from "@remixicon/react";
import type { PanelHost } from "@thinkrail/extension-api/web";
import { useT } from "@thinkrail/locales/react";
import { Button, IconButton } from "@thinkrail/ui/button";
import { isImeComposing } from "@thinkrail/ui/keyboard";
import { LoadingRegion } from "@thinkrail/ui/skeleton";
import { ToggleSegment } from "@thinkrail/ui/toggle-segment";
import { cn } from "@thinkrail/ui/utils";
import { lazy, type ReactNode, Suspense, useState } from "react";
import type { BoardLayout, BoardView } from "./api";
import { FIELD } from "./CardParts";
import { HORIZON_HINTS, HORIZON_LABELS } from "./labels";
import { AgentDots, HealthChip, HorizonChip, ProgressFigures, StackBar } from "./RoadmapParts";
import {
	acceptInitiative,
	appetiteUsed,
	createInitiative,
	deleteInitiative,
	goalGroups,
	HORIZONS,
	type Horizon,
	type HorizonEntry,
	horizonColumns,
	horizonMove,
	type Initiative,
	initiativeDependencies,
	initiativePeekEntry,
	loadRoadmap,
	moveInitiative,
	openRoadmapChat,
	type RoadmapView,
	rollupBar,
} from "./roadmapApi";
import { useBoardChanged, useHostQuery } from "./useHostQuery";

export type RoadmapSubView = "horizons" | "timeline" | "goals" | "graph";

const RoadmapFlow = lazy(() => import("./RoadmapFlow"));

export interface RoadmapActions {
	open: (initiative: Initiative) => void;
	create: (title: string, horizon: Horizon) => Promise<void>;
	move: (initiativeId: string, horizon: Horizon) => void;
	accept: (initiative: Initiative) => void;
	discard: (initiative: Initiative) => void;
}

function NewInitiativeForm({
	horizon,
	onCreate,
	onCancel,
}: {
	horizon: Horizon;
	onCreate: (title: string) => Promise<void>;
	onCancel: () => void;
}) {
	const t = useT();
	const [title, setTitle] = useState("");
	const [busy, setBusy] = useState(false);
	const submit = () => {
		const trimmed = title.trim();
		if (!trimmed || busy) return;
		setBusy(true);
		void onCreate(trimmed).finally(() => setBusy(false));
	};
	return (
		<form
			data-testid="board-initiative-new-form"
			data-horizon={horizon}
			className="flex items-center gap-4"
			onSubmit={(event) => {
				event.preventDefault();
				submit();
			}}
		>
			<input
				data-testid="board-initiative-new-title"
				aria-label={t("board.roadmap.newTitle")}
				placeholder={t("board.roadmap.newPlaceholder")}
				value={title}
				onChange={(event) => setTitle(event.currentTarget.value)}
				onKeyDown={(event) => {
					if (event.key !== "Escape" || isImeComposing(event.nativeEvent)) return;
					event.preventDefault();
					onCancel();
				}}
				ref={(node) => node?.focus()}
				className={FIELD}
			/>
			<Button type="submit" size="s" loading={busy} disabled={!title.trim()}>
				{t("board.roadmap.create")}
			</Button>
			<IconButton
				icon={RiCloseLine}
				size="s"
				label={t("board.newCard.cancel")}
				onClick={onCancel}
			/>
		</form>
	);
}

/** An initiative's horizon card: where it sits, its health, its live progress and what holds it. */
export function InitiativeCard({
	entry,
	view,
	after,
	actions,
}: {
	entry: HorizonEntry;
	view: RoadmapView;
	/** The initiatives it waits for. */
	after: readonly Initiative[];
	actions: RoadmapActions;
}) {
	const t = useT();
	const { initiative, goal, parent } = entry;
	const { setNodeRef, listeners, isDragging } = useDraggable({ id: initiative.id });
	const rollup = view.rollups.initiatives[initiative.id];
	const appetite = appetiteUsed(initiative, rollup);
	const [first] = after;
	return (
		<li
			ref={setNodeRef}
			data-testid="board-initiative"
			data-initiative-id={initiative.id}
			data-horizon={initiative.horizon}
			data-proposed={initiative.proposed || undefined}
			data-dragging={isDragging || undefined}
			className="flex min-w-0 flex-col gap-4 rounded-sm border border-border-muted bg-container-elevated-bg p-8 hover:border-border-default data-[dragging]:opacity-60 data-[proposed]:border-dashed"
		>
			<button
				type="button"
				aria-label={t("board.roadmap.open", { id: initiative.id, title: initiative.title })}
				data-testid="board-initiative-open"
				className="flex min-w-0 cursor-pointer flex-col gap-4 rounded-xs text-left focus-visible:focus-ring"
				{...listeners}
				onClick={() => actions.open(initiative)}
			>
				<span className="flex min-w-0 flex-wrap items-center gap-4">
					<span
						data-testid="board-initiative-goal"
						className="min-w-0 truncate rounded-xs bg-control-bg-selected px-4 tr-text-metadata text-text-muted"
					>
						{goal ? goal.title : t("board.roadmap.goalSelf")}
					</span>
					<HealthChip health={view.health[initiative.id]} />
					{initiative.proposed ? (
						<span
							data-testid="board-initiative-proposed"
							className="rounded-full bg-primary-subtle px-8 tr-text-label-pill text-primary"
						>
							{t("board.roadmap.proposed")}
						</span>
					) : null}
				</span>
				{parent ? (
					<span
						data-testid="board-initiative-crumb"
						className="truncate tr-text-metadata text-text-subtle"
					>
						{t("board.roadmap.crumb", { parent: parent.title })}
					</span>
				) : null}
				<span className="line-clamp-2 tr-text-emphasis text-text-default">{initiative.title}</span>
				{rollupBar(rollup).total > 0 ? <StackBar rollup={rollup} /> : null}
				<ProgressFigures rollup={rollup} />
				<span className="flex min-w-0 flex-wrap items-center gap-8">
					<AgentDots rollup={rollup} />
					{rollup && rollup.blocked > 0 ? (
						<span
							data-testid="board-initiative-blocked"
							className="flex items-center gap-2 tr-text-metadata text-feedback-error"
						>
							<RiForbidLine aria-hidden className="size-12" />
							{t("board.roadmap.blocked", { count: rollup.blocked })}
						</span>
					) : null}
				</span>
				{appetite || first ? (
					<span className="flex min-w-0 flex-wrap items-center gap-8 tr-text-metadata text-text-subtle">
						{appetite ? (
							<span
								data-testid="board-initiative-appetite"
								className={cn(
									"flex items-center gap-2 tabular-nums",
									appetite.percent > 80 && "text-feedback-warning",
								)}
							>
								<RiTimerLine aria-hidden className="size-12" />
								{t("board.roadmap.appetite", { used: appetite.used, days: appetite.appetite })}
							</span>
						) : null}
						{first ? (
							<span data-testid="board-initiative-after" className="min-w-0 truncate">
								{after.length > 1
									? t("board.roadmap.afterMany", { title: first.title, count: after.length - 1 })
									: t("board.roadmap.after", { title: first.title })}
							</span>
						) : null}
					</span>
				) : null}
			</button>
			{initiative.proposed ? (
				<span className="flex flex-wrap gap-4">
					<Button
						variant="soft-primary"
						size="s"
						iconLeft={RiCheckLine}
						data-testid="board-initiative-accept"
						onClick={() => actions.accept(initiative)}
					>
						{t("board.roadmap.accept")}
					</Button>
					<Button
						variant="ghost"
						size="s"
						iconLeft={RiDeleteBinLine}
						data-testid="board-initiative-discard"
						onClick={() => actions.discard(initiative)}
					>
						{t("board.roadmap.discard")}
					</Button>
				</span>
			) : null}
		</li>
	);
}

function HorizonColumn({
	horizon,
	layout,
	count,
	children,
	onCreate,
}: {
	horizon: Horizon;
	layout: BoardLayout;
	count: number;
	children: ReactNode;
	onCreate: (title: string) => Promise<void>;
}) {
	const t = useT();
	const { setNodeRef, isOver } = useDroppable({ id: horizon });
	const [adding, setAdding] = useState(false);
	return (
		<section
			ref={setNodeRef}
			data-testid="board-horizon"
			data-horizon={horizon}
			data-over={isOver || undefined}
			aria-label={t(HORIZON_LABELS[horizon])}
			className={cn(
				"flex min-h-0 flex-col gap-4 rounded-sm p-4 data-[over]:bg-primary-subtle data-[over]:ring-1 data-[over]:ring-inset data-[over]:ring-primary-soft",
				layout === "columns" ? "min-w-208 flex-1 basis-0" : "shrink-0",
			)}
		>
			<h3 className="flex items-baseline gap-4 px-4">
				<span className="tr-text-emphasis text-text-default">{t(HORIZON_LABELS[horizon])}</span>
				<span className="truncate tr-text-metadata text-text-subtle">
					{t(HORIZON_HINTS[horizon])}
				</span>
				<span className="ml-auto tabular-nums tr-text-metadata text-text-subtle">{count}</span>
			</h3>
			<ul className="flex flex-col gap-4">{children}</ul>
			{adding ? (
				<NewInitiativeForm
					horizon={horizon}
					onCreate={async (title) => {
						await onCreate(title);
						setAdding(false);
					}}
					onCancel={() => setAdding(false)}
				/>
			) : (
				<Button
					variant="ghost"
					size="s"
					iconLeft={RiAddLine}
					data-testid="board-initiative-new"
					className="self-start"
					onClick={() => setAdding(true)}
				>
					{t("board.roadmap.new")}
				</Button>
			)}
		</section>
	);
}

/** Now / Next / Later: every initiative on its horizon, dragged between them with `initiative.move`. */
export function HorizonsView({
	view,
	layout,
	actions,
}: {
	view: RoadmapView;
	layout: BoardLayout;
	actions: RoadmapActions;
}) {
	const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
	const [dragging, setDragging] = useState<Initiative | null>(null);
	const columns = horizonColumns(view);
	const after = initiativeDependencies(view);
	const onDragEnd = ({ active, over }: DragEndEvent) => {
		setDragging(null);
		const move = horizonMove(view, String(active.id), over ? String(over.id) : null);
		if (move) actions.move(move.initiativeId, move.horizon);
	};
	return (
		<DndContext
			sensors={sensors}
			collisionDetection={pointerWithin}
			onDragStart={({ active }: DragStartEvent) =>
				setDragging(view.initiatives.find((entry) => entry.id === active.id) ?? null)
			}
			onDragCancel={() => setDragging(null)}
			onDragEnd={onDragEnd}
		>
			<div
				data-testid="board-roadmap-horizons"
				className={cn(
					"min-h-0 flex-1 overflow-auto p-4",
					layout === "columns" ? "flex gap-8" : "flex flex-col gap-8",
				)}
			>
				{HORIZONS.map((horizon) => (
					<HorizonColumn
						key={horizon}
						horizon={horizon}
						layout={layout}
						count={columns[horizon].length}
						onCreate={(title) => actions.create(title, horizon)}
					>
						{columns[horizon].map((entry) => (
							<InitiativeCard
								key={entry.initiative.id}
								entry={entry}
								view={view}
								after={after.get(entry.initiative.id) ?? []}
								actions={actions}
							/>
						))}
					</HorizonColumn>
				))}
			</div>
			<DragOverlay dropAnimation={null}>
				{dragging ? (
					<div className="flex w-208 flex-col gap-4 rounded-sm border border-primary bg-container-elevated-bg p-8 shadow-lg">
						<HorizonChip horizon={dragging.horizon} />
						<span className="truncate tr-text-emphasis text-text-default">{dragging.title}</span>
					</div>
				) : null}
			</DragOverlay>
		</DndContext>
	);
}

function SpecRefChips({ refs }: { refs: readonly string[] }) {
	const t = useT();
	if (refs.length === 0) return null;
	return (
		<span className="flex min-w-0 flex-wrap items-center gap-4">
			{refs.map((ref) => (
				<span
					key={ref}
					data-testid="board-goal-spec"
					title={t("board.roadmap.specRef", { ref })}
					className="flex min-w-0 items-center gap-2 rounded-xs bg-control-bg-selected px-4 tr-code-text-small text-text-muted"
				>
					<RiFileList3Line aria-hidden className="size-12 shrink-0" />
					<span className="truncate">{ref}</span>
				</span>
			))}
		</span>
	);
}

/** Goals: each top-level initiative with what is nested under it, its horizon, progress and health. */
export function GoalsView({ view, actions }: { view: RoadmapView; actions: RoadmapActions }) {
	const t = useT();
	const groups = goalGroups(view);
	if (groups.length === 0)
		return (
			<div
				data-testid="board-roadmap-empty"
				className="flex flex-1 items-center justify-center p-16 text-center tr-text-ui text-text-muted"
			>
				{t("board.roadmap.empty")}
			</div>
		);
	return (
		<div
			data-testid="board-roadmap-goals"
			className="flex min-h-0 flex-1 flex-col gap-12 overflow-auto p-8"
		>
			{groups.map(({ goal, initiatives }) => {
				const rollup = view.rollups.initiatives[goal.id];
				return (
					<section
						key={goal.id}
						data-testid="board-goal"
						data-initiative-id={goal.id}
						className="flex min-w-0 flex-col gap-4 rounded-sm border border-border-muted bg-container-elevated-bg p-8"
					>
						<div className="flex min-w-0 flex-wrap items-center gap-8">
							<button
								type="button"
								data-testid="board-goal-open"
								className="min-w-0 truncate rounded-xs text-left tr-text-emphasis text-text-default focus-visible:focus-ring"
								onClick={() => actions.open(goal)}
							>
								{goal.title}
							</button>
							<SpecRefChips refs={goal.specRefs} />
							<span className="ml-auto flex items-center gap-8">
								<ProgressFigures rollup={rollup} />
								<HealthChip health={view.health[goal.id]} />
							</span>
						</div>
						{initiatives.length === 0 ? (
							<span className="tr-text-metadata text-text-subtle">
								{t("board.roadmap.goalEmpty")}
							</span>
						) : (
							<ul className="flex flex-col gap-2">
								{initiatives.map((initiative) => {
									const nested = view.rollups.initiatives[initiative.id];
									const bar = rollupBar(nested);
									return (
										<li
											key={initiative.id}
											data-testid="board-goal-initiative"
											data-initiative-id={initiative.id}
											data-depth={initiative.depth}
										>
											<button
												type="button"
												aria-label={t("board.roadmap.open", {
													id: initiative.id,
													title: initiative.title,
												})}
												className={cn(
													"grid w-full min-w-0 grid-cols-[auto_minmax(0,1fr)_96px_auto_auto] items-center gap-8 rounded-xs px-4 py-2 text-left hover:bg-control-bg-hovered focus-visible:focus-ring-inset",
													initiative.depth > 1 && "pl-16",
												)}
												onClick={() => actions.open(initiative)}
											>
												<HorizonChip horizon={initiative.horizon} />
												<span className="truncate tr-text-ui text-text-default">
													{initiative.title}
												</span>
												<StackBar rollup={nested} />
												<span className="w-32 text-right tabular-nums tr-text-metadata text-text-muted">
													{bar.total > 0
														? t("board.roadmap.percent", { percent: bar.percent })
														: t("board.roadmap.noPercent")}
												</span>
												<HealthChip health={view.health[initiative.id]} />
											</button>
										</li>
									);
								})}
							</ul>
						)}
					</section>
				);
			})}
		</div>
	);
}

/**
 * The Board tool's Roadmap view: the board's `roadmap.get`, re-read on `board.changed`, as Now / Next /
 * Later, the timeline, Goals or the step graph (those two a lazy chunk); an initiative opens in Peek.
 */
export function RoadmapPane({
	host,
	layout,
	board,
	onError,
}: {
	host: PanelHost;
	layout: BoardLayout;
	/** The Board tool's own `board.get`: the step graph's card titles and states. */
	board: BoardView | null;
	onError: (error: unknown) => void;
}) {
	const t = useT();
	const { workspaceId, projectId } = host.scope;
	const roadmap = useHostQuery(`roadmap:${workspaceId}:${projectId}`, (signal) =>
		loadRoadmap(host, projectId, signal),
	);
	useBoardChanged(host, projectId, roadmap.reload);
	const [sub, setSub] = useState<RoadmapSubView>("horizons");
	const [reviewing, setReviewing] = useState(false);
	const write = (run: () => Promise<unknown>) =>
		run().then(roadmap.reload, (error: unknown) => {
			onError(error);
			roadmap.reload();
		});
	const actions: RoadmapActions = {
		open: (initiative) => host.peek(initiativePeekEntry(projectId, initiative)),
		create: async (title, horizon) => {
			try {
				const created = await createInitiative(host, projectId, { title, horizon });
				roadmap.reload();
				host.peek(initiativePeekEntry(projectId, created));
			} catch (error) {
				onError(error);
			}
		},
		move: (initiativeId, horizon) =>
			void write(() => moveInitiative(host, projectId, initiativeId, horizon)),
		accept: (initiative) => void write(() => acceptInitiative(host, projectId, initiative.id)),
		discard: (initiative) => void write(() => deleteInitiative(host, projectId, initiative.id)),
	};
	const review = () => {
		setReviewing(true);
		openRoadmapChat(host, projectId, "review")
			.then((started) => {
				if (started.kickoffError)
					onError(new Error(t("board.roadmap.chat.notSent", { error: started.kickoffError })));
			}, onError)
			.finally(() => setReviewing(false));
	};
	return (
		<div data-testid="board-roadmap" data-view={sub} className="flex min-h-0 flex-1 flex-col">
			<div className="flex shrink-0 flex-wrap items-center gap-4 border-border-muted border-b px-8 py-2">
				<ToggleSegment
					testid="board-roadmap-view-horizons"
					label={t("board.roadmap.view.horizons")}
					active={sub === "horizons"}
					onClick={() => setSub("horizons")}
				/>
				<ToggleSegment
					testid="board-roadmap-view-timeline"
					label={t("board.roadmap.view.timeline")}
					active={sub === "timeline"}
					onClick={() => setSub("timeline")}
				/>
				<ToggleSegment
					testid="board-roadmap-view-goals"
					label={t("board.roadmap.view.goals")}
					active={sub === "goals"}
					onClick={() => setSub("goals")}
				/>
				<ToggleSegment
					testid="board-roadmap-view-graph"
					label={t("board.roadmap.view.graph")}
					active={sub === "graph"}
					onClick={() => setSub("graph")}
				/>
				<Button
					variant="ghost"
					size="s"
					iconLeft={RiDiscussLine}
					loading={reviewing}
					data-testid="board-roadmap-review"
					className="ml-auto"
					onClick={review}
				>
					{t("board.roadmap.chat.review")}
				</Button>
			</div>
			{roadmap.state.kind === "loading" ? (
				<LoadingRegion
					rows={6}
					label={t("board.loading")}
					testId="board-roadmap-loading"
					className="min-h-0 flex-1 overflow-hidden p-8"
				/>
			) : roadmap.state.kind === "error" ? (
				<div
					data-testid="board-roadmap-error"
					className="flex flex-1 flex-col items-center justify-center gap-8 p-16 text-center"
				>
					<span className="tr-text-ui text-text-muted">{t("board.roadmap.loadError")}</span>
					<span className="tr-text-metadata text-text-subtle wrap-anywhere">
						{roadmap.state.message}
					</span>
					<Button variant="outline" size="m" onClick={roadmap.reload}>
						{t("board.retry")}
					</Button>
				</div>
			) : sub === "horizons" ? (
				<HorizonsView view={roadmap.state.value} layout={layout} actions={actions} />
			) : sub === "goals" ? (
				<GoalsView view={roadmap.state.value} actions={actions} />
			) : (
				<Suspense
					fallback={
						<LoadingRegion
							rows={6}
							label={t("board.loading")}
							testId="board-roadmap-flow-loading"
							className="min-h-0 flex-1 overflow-hidden p-8"
						/>
					}
				>
					<RoadmapFlow
						host={host}
						view={roadmap.state.value}
						board={board}
						kind={sub}
						layout={layout}
						onError={onError}
						onReload={roadmap.reload}
					/>
				</Suspense>
			)}
		</div>
	);
}
