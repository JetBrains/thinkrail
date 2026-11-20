import {
	DndContext,
	type DragEndEvent,
	DragOverlay,
	type DragStartEvent,
	PointerSensor,
	pointerWithin,
	useDroppable,
	useSensor,
	useSensors,
} from "@dnd-kit/core";
import {
	RiAddLine,
	RiArrowDownSLine,
	RiBarChartBoxLine,
	RiCloseLine,
	RiCollapseDiagonalLine,
	RiExpandDiagonalLine,
	RiGithubLine,
	RiKanbanView2,
	RiListUnordered,
	RiRefreshLine,
	RiRoadMapLine,
	RiSettings3Line,
} from "@remixicon/react";
import type { PanelHost, PanelProps } from "@thinkrail/extension-api/web";
import { type Translator, useT } from "@thinkrail/locales/react";
import { Button, IconButton } from "@thinkrail/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@thinkrail/ui/dropdown-menu";
import { isImeComposing } from "@thinkrail/ui/keyboard";
import { type LocalKeys, useLocalKeys } from "@thinkrail/ui/local-keys";
import { Popover, PopoverContent, PopoverTrigger } from "@thinkrail/ui/popover";
import { LoadingRegion } from "@thinkrail/ui/skeleton";
import { Switch } from "@thinkrail/ui/switch";
import { cn } from "@thinkrail/ui/utils";
import { type KeyboardEvent, type ReactNode, useEffect, useState } from "react";
import {
	acceptTriage,
	adjacentColumn,
	adoptCard,
	attentionWarning,
	BOARD_MODE,
	type BoardLayout,
	type BoardSettings,
	type BoardView,
	boardLayout,
	type Card,
	type Column,
	canAdopt,
	cardPeekEntry,
	cardsIn,
	columnWip,
	createCard,
	deleteCard,
	enterCard,
	GITHUB_FILTERS,
	type GithubFilter,
	type GithubStatus,
	type ListSort,
	loadBoard,
	moveCard,
	moveOnDrop,
	overLimit,
	type Preset,
	presetsFor,
	proposeChange,
	refreshGithub,
	selectCard,
	setFollowSelection,
	setGithub,
	setPreset,
	setWipLimits,
	startCard,
	WIP_KEYS,
	type WipCount,
	workflowFor,
} from "./api";
import { CardList } from "./CardList";
import { CardMeta, FIELD } from "./CardParts";
import { type CardActions, CardTile } from "./CardTile";
import { InboxStrip, useInbox } from "./Inbox";
import { InsightsPane } from "./Insights";
import { CARD_COMMANDS, CARD_KEYS, CARDS_SCOPE } from "./keys";
import {
	columnTitle,
	GITHUB_FILTER_LABELS,
	GITHUB_PROBLEMS,
	PRESET_LABELS,
	startWarningText,
	WIP_LABELS,
} from "./labels";
import { InstallHint, ProposeForm } from "./OpenspecParts";
import { BoardMoreMenu, PublishDialog } from "./PublishDialog";
import { RoadmapPane } from "./Roadmap";
import { type TriageActions, TriageLane } from "./Triage";
import { useBoardActivity, useBoardChanged, useHostQuery } from "./useHostQuery";

export type BoardMode = "board" | "list" | "roadmap" | "insights";

/** The board's columns, Canceled only while it holds cards; Triage is its own lane (`TriageLane`). */
export function shownColumns(view: Pick<BoardView, "columns" | "cards">): Column[] {
	return view.columns.filter(
		(column) =>
			!column.categories.includes("triage") &&
			(!column.hidden || cardsIn(view, column.id).length > 0),
	);
}

function useMeasuredRoot(): {
	node: HTMLElement | null;
	width: number;
	attach: (node: HTMLElement | null) => void;
} {
	const [node, setNode] = useState<HTMLElement | null>(null);
	const [width, setWidth] = useState(0);
	useEffect(() => {
		if (!node) return;
		const observer = new ResizeObserver(([entry]) => setWidth(entry?.contentRect.width ?? 0));
		observer.observe(node);
		return () => observer.disconnect();
	}, [node]);
	return { node, width, attach: setNode };
}

function WipFigure({ wip, testId }: { wip: WipCount; testId: string }) {
	const over = overLimit(wip);
	return (
		<span
			data-testid={testId}
			data-over={over || undefined}
			className={cn("tabular-nums", over ? "text-feedback-error" : "text-text-subtle")}
		>
			{wip.limit > 0 ? `${wip.count}/${wip.limit}` : wip.count}
		</span>
	);
}

function ColumnDrop({
	column,
	count,
	wip,
	layout,
	children,
}: {
	column: Column;
	count: number;
	/** A Review column's count against the Review limit. */
	wip: WipCount | null;
	layout: BoardLayout;
	children: ReactNode;
}) {
	const t = useT();
	const { setNodeRef, isOver } = useDroppable({ id: column.id });
	return (
		<section
			ref={setNodeRef}
			data-testid="board-column"
			data-column={column.id}
			data-over={isOver || undefined}
			aria-label={columnTitle(t, column.id)}
			className={cn(
				"flex min-h-0 flex-col gap-4 rounded-sm data-[over]:bg-primary-subtle data-[over]:ring-1 data-[over]:ring-inset data-[over]:ring-primary-soft",
				layout === "columns" ? "w-208 shrink-0 p-4" : "shrink-0 p-4",
			)}
		>
			<h3 className="flex items-center gap-4 px-4 tr-text-eyebrow text-text-muted">
				<span className="truncate">{columnTitle(t, column.id)}</span>
				<span data-testid="board-column-count" className="tabular-nums text-text-subtle">
					{count}
				</span>
				{wip ? (
					<span className="ml-auto flex items-center gap-4 normal-case">
						{t("board.wip.short")}
						<WipFigure wip={wip} testId="board-column-wip" />
					</span>
				) : null}
			</h3>
			{children}
		</section>
	);
}

export function BoardColumns({
	view,
	layout,
	actions,
	triage,
	starting,
	startWarning,
	onDragEnd,
}: {
	view: BoardView;
	layout: BoardLayout;
	actions: CardActions;
	triage: TriageActions;
	starting: string | null;
	startWarning: { cardId: string; text: string } | null;
	onDragEnd: (event: DragEndEvent) => void;
}) {
	const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
	const [dragging, setDragging] = useState<Card | null>(null);
	return (
		<DndContext
			sensors={sensors}
			collisionDetection={pointerWithin}
			onDragStart={({ active }: DragStartEvent) =>
				setDragging(view.cards.find((card) => card.id === active.id) ?? null)
			}
			onDragCancel={() => setDragging(null)}
			onDragEnd={(event) => {
				setDragging(null);
				onDragEnd(event);
			}}
		>
			<div
				className={cn(
					"min-h-0 flex-1 overflow-auto p-4",
					layout === "columns" ? "flex gap-8" : "flex flex-col gap-8",
				)}
			>
				<TriageLane view={view} layout={layout} actions={triage} />
				{shownColumns(view).map((column) => {
					const cards = cardsIn(view, column.id);
					return (
						<ColumnDrop
							key={column.id}
							column={column}
							count={cards.length}
							wip={columnWip(view, column)}
							layout={layout}
						>
							<ul className={cn("flex flex-col gap-4", layout === "columns" && "min-h-32")}>
								{cards.map((card) => (
									<CardTile
										key={card.id}
										card={card}
										actions={actions}
										starting={starting === card.id}
										startWarning={startWarning?.cardId === card.id ? startWarning.text : null}
										compact={layout === "stacked"}
									/>
								))}
							</ul>
						</ColumnDrop>
					);
				})}
			</div>
			<DragOverlay dropAnimation={null}>
				{dragging ? (
					<div className="flex w-208 flex-col gap-4 rounded-sm border border-primary bg-container-elevated-bg p-8 shadow-lg">
						<CardMeta card={dragging} />
						<span className="truncate tr-text-ui text-text-default">{dragging.title}</span>
					</div>
				) : null}
			</DragOverlay>
		</DndContext>
	);
}

function NewCardForm({
	onCreate,
	onCancel,
}: {
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
			data-testid="board-new-card"
			className="flex shrink-0 items-center gap-4 border-border-muted border-b px-8 py-4"
			onSubmit={(event) => {
				event.preventDefault();
				submit();
			}}
		>
			<input
				data-testid="board-new-card-title"
				aria-label={t("board.newCard.title")}
				placeholder={t("board.newCard.placeholder")}
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
				{t("board.newCard.create")}
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

function PresetMenu({
	preset,
	presets,
	onPreset,
}: {
	preset: Preset;
	presets: readonly Preset[];
	onPreset: (preset: Preset) => void;
}) {
	const t = useT();
	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button
					variant="ghost"
					size="s"
					iconRight={RiArrowDownSLine}
					data-testid="board-preset"
					data-preset={preset}
				>
					{t(PRESET_LABELS[preset])}
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="start">
				<DropdownMenuRadioGroup
					value={preset}
					onValueChange={(value) => {
						const next = presets.find((candidate) => candidate === value);
						if (next) onPreset(next);
					}}
				>
					{presets.map((candidate) => (
						<DropdownMenuRadioItem
							key={candidate}
							value={candidate}
							data-testid={`board-preset-${candidate}`}
						>
							{t(PRESET_LABELS[candidate])}
						</DropdownMenuRadioItem>
					))}
				</DropdownMenuRadioGroup>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

function WipChips({ view }: { view: BoardView }) {
	const t = useT();
	return (
		<span className="flex flex-wrap items-center gap-8 tr-text-metadata text-text-muted">
			{WIP_KEYS.map((key) => (
				<span key={key} className="flex items-center gap-4">
					{t(WIP_LABELS[key])}
					<WipFigure wip={view.wip[key]} testId={`board-wip-${key}`} />
				</span>
			))}
		</span>
	);
}

/** The board's settings: follow selection, applied at once, and the WIP limits, saved together. */
function BoardSettingsMenu({
	settings,
	onFollow,
	onSave,
}: {
	settings: BoardSettings;
	onFollow: (followSelection: boolean) => void;
	onSave: (limits: BoardSettings["wipLimits"]) => void;
}) {
	const t = useT();
	const [open, setOpen] = useState(false);
	const [draft, setDraft] = useState(settings.wipLimits);
	return (
		<Popover
			open={open}
			onOpenChange={(next) => {
				setOpen(next);
				if (next) setDraft(settings.wipLimits);
			}}
		>
			<PopoverTrigger asChild>
				<IconButton
					icon={RiSettings3Line}
					size="s"
					label={t("board.settings.open")}
					data-testid="board-settings"
				/>
			</PopoverTrigger>
			<PopoverContent align="end" className="flex w-280 flex-col gap-12 p-12">
				<div className="flex items-start justify-between gap-8">
					<span className="flex min-w-0 flex-col gap-2">
						<span className="tr-text-emphasis text-text-default">{t("board.settings.follow")}</span>
						<span className="tr-text-metadata text-text-subtle">
							{t("board.settings.followHint")}
						</span>
					</span>
					<Switch
						checked={settings.followSelection}
						label={t("board.settings.follow")}
						testId="board-follow-selection"
						onCheckedChange={onFollow}
					/>
				</div>
				<form
					data-testid="board-wip-form"
					className="flex flex-col gap-8"
					onSubmit={(event) => {
						event.preventDefault();
						onSave(draft);
						setOpen(false);
					}}
				>
					<span className="tr-text-emphasis text-text-default">{t("board.settings.wip")}</span>
					{WIP_KEYS.map((key) => (
						<label key={key} className="flex items-center justify-between gap-8">
							<span className="tr-text-ui text-text-default">{t(WIP_LABELS[key])}</span>
							<input
								type="number"
								min={0}
								max={99}
								step={1}
								data-testid={`board-wip-limit-${key}`}
								value={draft[key]}
								onChange={(event) => {
									const value = Number.parseInt(event.currentTarget.value, 10);
									setDraft((current) => ({
										...current,
										[key]: Number.isFinite(value) ? Math.min(99, Math.max(0, value)) : 0,
									}));
								}}
								className={cn(FIELD, "w-64 tabular-nums")}
							/>
						</label>
					))}
					<span className="tr-text-metadata text-text-subtle">{t("board.settings.wipHint")}</span>
					<Button type="submit" size="s" data-testid="board-wip-save" className="self-end">
						{t("board.settings.save")}
					</Button>
				</form>
			</PopoverContent>
		</Popover>
	);
}

function ModeToggle({
	active,
	compact,
	onToggle,
}: {
	active: boolean;
	compact: boolean;
	onToggle: () => void;
}) {
	const t = useT();
	const label = active ? t("board.mode.exit") : t("board.mode.enter");
	if (compact)
		return (
			<IconButton
				icon={active ? RiCollapseDiagonalLine : RiExpandDiagonalLine}
				size="s"
				label={label}
				data-testid="board-mode-toggle"
				data-active={active || undefined}
				selected={active}
				onClick={onToggle}
			/>
		);
	return (
		<Button
			variant={active ? "soft-primary" : "ghost"}
			size="s"
			iconLeft={active ? RiCollapseDiagonalLine : RiExpandDiagonalLine}
			data-testid="board-mode-toggle"
			data-active={active || undefined}
			onClick={onToggle}
		>
			{label}
		</Button>
	);
}

/** The board's GitHub source: show or hide the project's issues, which ones, and refresh them. */
export function GithubMenu({
	github,
	onShow,
	onFilter,
	onRefresh,
}: {
	github: GithubStatus;
	onShow: (enabled: boolean) => void;
	onFilter: (filter: GithubFilter) => void;
	onRefresh: () => void;
}) {
	const t = useT();
	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<IconButton
					icon={RiGithubLine}
					size="s"
					label={t("board.github.menu")}
					data-testid="board-github-menu"
					data-enabled={github.enabled || undefined}
					selected={github.enabled}
				/>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end">
				<DropdownMenuItem
					data-testid="board-github-toggle"
					onSelect={() => onShow(!github.enabled)}
				>
					{github.enabled ? t("board.github.hide") : t("board.github.show")}
				</DropdownMenuItem>
				{github.enabled ? (
					<>
						<DropdownMenuSeparator />
						<DropdownMenuLabel>{t("board.github.filter.title")}</DropdownMenuLabel>
						<DropdownMenuRadioGroup
							value={github.filter}
							onValueChange={(value) => {
								const next = GITHUB_FILTERS.find((candidate) => candidate === value);
								if (next) onFilter(next);
							}}
						>
							{GITHUB_FILTERS.map((filter) => (
								<DropdownMenuRadioItem
									key={filter}
									value={filter}
									data-testid={`board-github-filter-${filter}`}
								>
									{t(GITHUB_FILTER_LABELS[filter])}
								</DropdownMenuRadioItem>
							))}
						</DropdownMenuRadioGroup>
						<DropdownMenuSeparator />
						<DropdownMenuItem
							data-testid="board-github-refresh"
							disabled={github.loading}
							onSelect={onRefresh}
						>
							<RiRefreshLine aria-hidden className="size-16" />
							{github.loading ? t("board.github.loading") : t("board.github.refresh")}
						</DropdownMenuItem>
					</>
				) : null}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

/** A failed issue fetch: a notice over the board, which keeps showing the last good issues. */
export function GithubBanner({
	github,
	onRefresh,
	onDismiss,
}: {
	github: GithubStatus;
	onRefresh: () => void;
	onDismiss: () => void;
}) {
	const t = useT();
	if (!github.enabled || !github.error) return null;
	return (
		<div
			role="status"
			data-testid="board-github-error"
			className="flex shrink-0 items-start gap-4 border-border-muted border-b bg-feedback-warning-subtle px-8 py-4 tr-text-metadata text-feedback-warning"
		>
			<RiGithubLine aria-hidden className="mt-2 size-12 shrink-0" />
			<span className="min-w-0 flex-1 wrap-anywhere">
				{t("board.github.error", { error: github.error })}
			</span>
			<Button
				variant="ghost"
				size="s"
				data-testid="board-github-retry"
				loading={github.loading}
				onClick={onRefresh}
			>
				{t("board.github.refresh")}
			</Button>
			<IconButton
				icon={RiCloseLine}
				size="s"
				label={t("board.notice.dismiss")}
				onClick={onDismiss}
			/>
		</div>
	);
}

function BoardHeader({
	view,
	compact,
	mode,
	boardMode,
	onMode,
	onPreset,
	onFollow,
	onWipLimits,
	onBoardMode,
	onGithub,
	onGithubFilter,
	onGithubRefresh,
	onPublish,
	onNew,
	onPropose,
}: {
	view: BoardView | null;
	/** A narrow pane: the WIP figures stay in the column headers and the toggle is an icon. */
	compact: boolean;
	mode: BoardMode;
	boardMode: boolean;
	onMode: (mode: BoardMode) => void;
	onPreset: (preset: Preset) => void;
	onFollow: (followSelection: boolean) => void;
	onWipLimits: (limits: BoardSettings["wipLimits"]) => void;
	/** Absent on a host without layout modes. */
	onBoardMode: (() => void) | null;
	onGithub: (enabled: boolean) => void;
	onGithubFilter: (filter: GithubFilter) => void;
	onGithubRefresh: () => void;
	onPublish: () => void;
	onNew: () => void;
	onPropose: () => void;
}) {
	const t = useT();
	return (
		<div
			role="toolbar"
			aria-label={t("board.tool.title")}
			className="flex min-h-panel-header-row shrink-0 flex-wrap items-center gap-4 border-border-default border-b px-8 py-2"
		>
			<span
				data-testid="board-project"
				className="min-w-0 truncate tr-text-emphasis text-text-default"
			>
				{view?.projectName ?? ""}
			</span>
			{view ? (
				<PresetMenu preset={view.settings.preset} presets={presetsFor(view)} onPreset={onPreset} />
			) : null}
			{view && !compact ? <WipChips view={view} /> : null}
			<span className="ml-auto flex items-center gap-2">
				{onBoardMode ? (
					<ModeToggle active={boardMode} compact={compact} onToggle={onBoardMode} />
				) : null}
				{view ? (
					<GithubMenu
						github={view.github}
						onShow={onGithub}
						onFilter={onGithubFilter}
						onRefresh={onGithubRefresh}
					/>
				) : null}
				{view ? (
					<BoardSettingsMenu settings={view.settings} onFollow={onFollow} onSave={onWipLimits} />
				) : null}
				<BoardMoreMenu onPublish={onPublish} />
				<IconButton
					icon={RiKanbanView2}
					size="s"
					label={t("board.view.board")}
					data-testid="board-view-board"
					aria-pressed={mode === "board"}
					selected={mode === "board"}
					onClick={() => onMode("board")}
				/>
				<IconButton
					icon={RiListUnordered}
					size="s"
					label={t("board.view.list")}
					data-testid="board-view-list"
					aria-pressed={mode === "list"}
					selected={mode === "list"}
					onClick={() => onMode("list")}
				/>
				<IconButton
					icon={RiRoadMapLine}
					size="s"
					label={t("board.view.roadmap")}
					data-testid="board-view-roadmap"
					aria-pressed={mode === "roadmap"}
					selected={mode === "roadmap"}
					onClick={() => onMode("roadmap")}
				/>
				<IconButton
					icon={RiBarChartBoxLine}
					size="s"
					label={t("board.view.insights")}
					data-testid="board-view-insights"
					aria-pressed={mode === "insights"}
					selected={mode === "insights"}
					onClick={() => onMode("insights")}
				/>
				{view?.openspec?.present ? (
					<Button
						variant="outline"
						size="s"
						iconLeft={RiAddLine}
						data-testid="board-openspec-propose"
						onClick={onPropose}
					>
						{t("board.openspec.propose")}
					</Button>
				) : null}
				<Button
					variant="soft-primary"
					size="s"
					iconLeft={RiAddLine}
					data-testid="board-new"
					disabled={!view}
					onClick={onNew}
				>
					{t("board.newCard.open")}
				</Button>
			</span>
		</div>
	);
}

function moveCommand(
	keys: Pick<LocalKeys, "match">,
	event: KeyboardEvent<HTMLElement>,
): -1 | 1 | null {
	const id = keys.match(event.nativeEvent);
	if (id === CARD_KEYS.moveLeft) return -1;
	if (id === CARD_KEYS.moveRight) return 1;
	return null;
}

function errorMessage(t: Translator, error: unknown): string {
	return error instanceof Error && error.message ? error.message : t("board.error.unknown");
}

export function BoardBody({
	view,
	mode,
	layout,
	sort,
	actions,
	triage,
	starting,
	startWarning,
	onSort,
	onDragEnd,
	onNew,
}: {
	view: BoardView;
	mode: BoardMode;
	layout: BoardLayout;
	sort: ListSort;
	actions: CardActions;
	triage: TriageActions;
	starting: string | null;
	startWarning: { cardId: string; text: string } | null;
	onSort: (sort: ListSort) => void;
	onDragEnd: (event: DragEndEvent) => void;
	onNew: () => void;
}) {
	const t = useT();
	if (view.cards.length === 0) {
		return (
			<div
				data-testid="board-empty"
				className="flex flex-1 flex-col items-center justify-center gap-8 p-16 text-center"
			>
				<span className="tr-text-ui text-text-muted">{t("board.empty")}</span>
				<Button variant="outline" size="m" iconLeft={RiAddLine} onClick={onNew}>
					{t("board.newCard.open")}
				</Button>
			</div>
		);
	}
	if (mode === "list") {
		return <CardList view={view} sort={sort} onSort={onSort} onOpen={actions.open} />;
	}
	return (
		<BoardColumns
			view={view}
			layout={layout}
			actions={actions}
			triage={triage}
			starting={starting}
			startWarning={startWarning}
			onDragEnd={onDragEnd}
		/>
	);
}

/** Enters or leaves Board mode, on a host that has layout modes. */
function boardModeToggle(host: PanelHost): (() => void) | null {
	if (!host.enterLayoutPreset || !host.exitLayoutPreset) return null;
	return () =>
		host.layoutPreset === BOARD_MODE
			? host.exitLayoutPreset?.()
			: host.enterLayoutPreset?.(BOARD_MODE);
}

/** The Board side tool: the active workspace's project's board, adaptive to its pane's width. */
export default function BoardTool({ host }: PanelProps) {
	const t = useT();
	const { workspaceId, projectId } = host.scope;
	const board = useHostQuery(`${workspaceId}:${projectId}`, (signal) =>
		loadBoard(host, projectId, signal),
	);
	useBoardChanged(host, projectId, board.reload);
	useBoardActivity(host, projectId, board.reload);
	const inbox = useInbox(host);
	const [mode, setMode] = useState<BoardMode>("board");
	const [confirmStart, setConfirmStart] = useState<string | null>(null);
	const [sort, setSort] = useState<ListSort>("column");
	const { node: root, width, attach } = useMeasuredRoot();
	const [starting, setStarting] = useState<string | null>(null);
	const [notice, setNotice] = useState<string | null>(null);
	const [creating, setCreating] = useState(false);
	const [proposing, setProposing] = useState(false);
	const [publishing, setPublishing] = useState(false);
	const [focusCard, setFocusCard] = useState<{ id: string; column: string } | null>(null);
	const keys = useLocalKeys(CARDS_SCOPE, CARD_COMMANDS);
	const view = board.state.kind === "ready" ? board.state.value : null;
	useEffect(() => {
		if (!focusCard || !root) return;
		const selector = `[data-card-id="${CSS.escape(focusCard.id)}"][data-column="${CSS.escape(focusCard.column)}"] [data-testid="board-card-open"]`;
		const target = root.querySelector<HTMLElement>(selector);
		if (!target) return;
		target.focus();
		setFocusCard(null);
	}, [focusCard, root, view]);
	const write = (run: () => Promise<unknown>) =>
		run().then(board.reload, (error: unknown) => {
			setNotice(errorMessage(t, error));
			board.reload();
		});
	const actions: CardActions = {
		open: (card) => selectCard(host, projectId, card, view?.settings.followSelection ?? false),
		enter: (card) => enterCard(host, projectId, card),
		start: (card, anyway = false) => {
			if (!anyway && attentionWarning(view)) {
				setConfirmStart(card.id);
				return;
			}
			setConfirmStart(null);
			setStarting(card.id);
			void write(() =>
				startCard(host, card.id, { workflow: workflowFor(card) }, projectId),
			).finally(() => setStarting(null));
		},
		adopt: (card) => {
			setStarting(card.id);
			void write(() => adoptCard(host, card.id)).finally(() => setStarting(null));
		},
		cancelStart: () => setConfirmStart(null),
		keyDown: (card, event) => {
			const delta = moveCommand(keys, event);
			if (delta === null || !view || canAdopt(card)) return;
			event.preventDefault();
			const column = adjacentColumn(view, card, delta);
			if (!column) return;
			setFocusCard({ id: card.id, column });
			void write(() => moveCard(host, card.id, column, projectId));
		},
	};
	const triage: TriageActions = {
		accept: (cardIds) => void write(() => acceptTriage(host, cardIds)),
		dismiss: (cardIds) =>
			void write(async () => {
				for (const id of cardIds) await deleteCard(host, id);
			}),
		open: actions.open,
	};
	const warning = confirmStart ? attentionWarning(view) : null;
	const startWarning =
		confirmStart && warning ? { cardId: confirmStart, text: startWarningText(t, warning) } : null;
	const onDragEnd = ({ active, over }: DragEndEvent) => {
		if (!view) return;
		const moving = moveOnDrop(host, view, String(active.id), over ? String(over.id) : null);
		if (moving) void write(() => moving);
	};
	const create = async (title: string) => {
		try {
			const card = await createCard(host, projectId, title);
			setCreating(false);
			board.reload();
			host.peek(cardPeekEntry(projectId, card));
		} catch (error) {
			setNotice(errorMessage(t, error));
		}
	};
	const propose = async (description: string) => {
		try {
			const started = await proposeChange(host, projectId, description);
			setProposing(false);
			if (started.kickoffError)
				setNotice(t("board.roadmap.chat.notSent", { error: started.kickoffError }));
		} catch (error) {
			setNotice(errorMessage(t, error));
		}
	};
	const [hiddenError, setHiddenError] = useState<string | null>(null);
	const showGithub = (enabled: boolean) =>
		void write(async () => {
			const { problem } = await setGithub(host, projectId, { enabled });
			if (problem) setNotice(t(GITHUB_PROBLEMS[problem]));
		});
	const refreshIssues = () => void write(() => refreshGithub(host, projectId));
	const layout = boardLayout(width);
	return (
		<div
			ref={attach}
			data-testid="board-tool"
			data-layout={layout}
			data-mode={mode}
			data-key-scope={CARDS_SCOPE}
			className="flex h-full min-h-0 flex-col bg-container-sidebar-bg"
		>
			<BoardHeader
				view={view}
				compact={layout === "stacked"}
				mode={mode}
				boardMode={host.layoutPreset === BOARD_MODE}
				onMode={setMode}
				onPreset={(preset) => void write(() => setPreset(host, projectId, preset))}
				onFollow={(follow) => void write(() => setFollowSelection(host, projectId, follow))}
				onWipLimits={(limits) => void write(() => setWipLimits(host, projectId, limits))}
				onBoardMode={boardModeToggle(host)}
				onGithub={showGithub}
				onGithubFilter={(filter) => void write(() => setGithub(host, projectId, { filter }))}
				onGithubRefresh={refreshIssues}
				onPublish={() => setPublishing(true)}
				onNew={() => setCreating(true)}
				onPropose={() => setProposing(true)}
			/>
			{publishing ? (
				<PublishDialog
					host={host}
					projectId={projectId}
					path={view?.settings.snapshotPath}
					onClose={() => setPublishing(false)}
				/>
			) : null}
			<InboxStrip host={host} items={inbox} compact={layout === "stacked"} />
			{view && view.github.error !== hiddenError ? (
				<GithubBanner
					github={view.github}
					onRefresh={refreshIssues}
					onDismiss={() => setHiddenError(view.github.error)}
				/>
			) : null}
			{creating ? <NewCardForm onCreate={create} onCancel={() => setCreating(false)} /> : null}
			{proposing ? <ProposeForm onPropose={propose} onCancel={() => setProposing(false)} /> : null}
			{view?.openspec?.present &&
			!view.openspec.cli &&
			!view.openspec.checking &&
			view.settings.preset === "spec-driven" ? (
				<InstallHint className="shrink-0 border-border-muted border-b px-8 py-4" />
			) : null}
			{notice ? (
				<div
					role="alert"
					data-testid="board-notice"
					className="flex shrink-0 items-start gap-4 border-border-muted border-b bg-feedback-error-subtle px-8 py-4 tr-text-metadata text-feedback-error"
				>
					<span className="min-w-0 flex-1 wrap-anywhere">{notice}</span>
					<IconButton
						icon={RiCloseLine}
						size="s"
						label={t("board.notice.dismiss")}
						onClick={() => setNotice(null)}
					/>
				</div>
			) : null}
			{mode === "insights" ? (
				<InsightsPane host={host} layout={layout} />
			) : mode === "roadmap" ? (
				<RoadmapPane
					host={host}
					layout={layout}
					board={view}
					onError={(error) => setNotice(errorMessage(t, error))}
				/>
			) : board.state.kind === "loading" ? (
				<LoadingRegion
					rows={8}
					label={t("board.loading")}
					testId="board-loading"
					className="min-h-0 flex-1 overflow-hidden p-8"
				/>
			) : board.state.kind === "error" ? (
				<div
					data-testid="board-error"
					className="flex flex-1 flex-col items-center justify-center gap-8 p-16 text-center"
				>
					<span className="tr-text-ui text-text-muted">{t("board.error.load")}</span>
					<span className="tr-text-metadata text-text-subtle wrap-anywhere">
						{board.state.message}
					</span>
					<Button variant="outline" size="m" onClick={board.reload}>
						{t("board.retry")}
					</Button>
				</div>
			) : (
				<BoardBody
					view={board.state.value}
					mode={mode}
					layout={layout}
					sort={sort}
					actions={actions}
					triage={triage}
					starting={starting}
					startWarning={startWarning}
					onSort={setSort}
					onDragEnd={onDragEnd}
					onNew={() => setCreating(true)}
				/>
			)}
		</div>
	);
}
