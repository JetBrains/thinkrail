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
	RiCloseLine,
	RiKanbanView2,
	RiListUnordered,
} from "@remixicon/react";
import type { PanelHost, PanelProps } from "@thinkrail/extension-api/web";
import { type Translator, useT } from "@thinkrail/locales/react";
import { Button, IconButton } from "@thinkrail/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuTrigger,
} from "@thinkrail/ui/dropdown-menu";
import { isImeComposing } from "@thinkrail/ui/keyboard";
import { type LocalKeys, useLocalKeys } from "@thinkrail/ui/local-keys";
import { LoadingRegion } from "@thinkrail/ui/skeleton";
import { cn } from "@thinkrail/ui/utils";
import { type KeyboardEvent, type ReactNode, useEffect, useState } from "react";
import {
	adjacentColumn,
	type BoardLayout,
	type BoardView,
	boardLayout,
	CARD_PANEL,
	type Card,
	type Column,
	cardsIn,
	createCard,
	type ListSort,
	loadBoard,
	moveCard,
	moveOnDrop,
	openAttempt,
	PRESETS,
	type Preset,
	setPreset,
	startCard,
	workflowFor,
} from "./api";
import { CardList } from "./CardList";
import { CardMeta, FIELD } from "./CardParts";
import { type CardActions, CardTile } from "./CardTile";
import { CARD_COMMANDS, CARD_KEYS, CARDS_SCOPE } from "./keys";
import { columnTitle, PRESET_LABELS } from "./labels";
import { useBoardChanged, useHostQuery } from "./useHostQuery";

export type BoardMode = "board" | "list";

/** The board's columns, Triage and Canceled only while they hold cards. */
export function shownColumns(view: Pick<BoardView, "columns" | "cards">): Column[] {
	return view.columns.filter((column) => !column.hidden || cardsIn(view, column.id).length > 0);
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

function peekCard(host: PanelHost, projectId: string, card: Pick<Card, "id" | "title">) {
	host.peek({
		kind: "extension",
		panel: CARD_PANEL,
		params: { projectId, cardId: card.id },
		title: `${card.id} · ${card.title}`,
	});
}

function ColumnDrop({
	column,
	count,
	layout,
	children,
}: {
	column: Column;
	count: number;
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
				<span className="tabular-nums text-text-subtle">{count}</span>
			</h3>
			{children}
		</section>
	);
}

export function BoardColumns({
	view,
	layout,
	actions,
	starting,
	onDragEnd,
}: {
	view: BoardView;
	layout: BoardLayout;
	actions: CardActions;
	starting: string | null;
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
				{shownColumns(view).map((column) => {
					const cards = cardsIn(view, column.id);
					return (
						<ColumnDrop key={column.id} column={column} count={cards.length} layout={layout}>
							<ul className={cn("flex flex-col gap-4", layout === "columns" && "min-h-32")}>
								{cards.map((card) => (
									<CardTile
										key={card.id}
										card={card}
										actions={actions}
										starting={starting === card.id}
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

function PresetMenu({ preset, onPreset }: { preset: Preset; onPreset: (preset: Preset) => void }) {
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
						const next = PRESETS.find((candidate) => candidate === value);
						if (next) onPreset(next);
					}}
				>
					{PRESETS.map((candidate) => (
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

function BoardHeader({
	view,
	mode,
	onMode,
	onPreset,
	onNew,
}: {
	view: BoardView | null;
	mode: BoardMode;
	onMode: (mode: BoardMode) => void;
	onPreset: (preset: Preset) => void;
	onNew: () => void;
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
			{view ? <PresetMenu preset={view.settings.preset} onPreset={onPreset} /> : null}
			<span className="ml-auto flex items-center gap-2">
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
	starting,
	onSort,
	onDragEnd,
	onNew,
}: {
	view: BoardView;
	mode: BoardMode;
	layout: BoardLayout;
	sort: ListSort;
	actions: CardActions;
	starting: string | null;
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
			starting={starting}
			onDragEnd={onDragEnd}
		/>
	);
}

/** The Board side tool: the active workspace's project's board, adaptive to its pane's width. */
export default function BoardTool({ host }: PanelProps) {
	const t = useT();
	const { workspaceId, projectId } = host.scope;
	const board = useHostQuery(`${workspaceId}:${projectId}`, (signal) =>
		loadBoard(host, projectId, signal),
	);
	useBoardChanged(host, projectId, board.reload);
	const [mode, setMode] = useState<BoardMode>("board");
	const [sort, setSort] = useState<ListSort>("column");
	const { node: root, width, attach } = useMeasuredRoot();
	const [starting, setStarting] = useState<string | null>(null);
	const [notice, setNotice] = useState<string | null>(null);
	const [creating, setCreating] = useState(false);
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
		open: (card) => peekCard(host, projectId, card),
		enter: (card) => {
			const attempt = openAttempt(card);
			if (attempt)
				host.openWorkspace({
					workspaceId: attempt.workspaceId,
					projectId,
					sessionId: attempt.sessionId,
				});
		},
		start: (card) => {
			setStarting(card.id);
			void write(() => startCard(host, card.id, { workflow: workflowFor(card) })).finally(() =>
				setStarting(null),
			);
		},
		keyDown: (card, event) => {
			const delta = moveCommand(keys, event);
			if (delta === null || !view) return;
			event.preventDefault();
			const column = adjacentColumn(view, card, delta);
			if (!column) return;
			setFocusCard({ id: card.id, column });
			void write(() => moveCard(host, card.id, column));
		},
	};
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
			peekCard(host, projectId, card);
		} catch (error) {
			setNotice(errorMessage(t, error));
		}
	};
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
				mode={mode}
				onMode={setMode}
				onPreset={(preset) => void write(() => setPreset(host, projectId, preset))}
				onNew={() => setCreating(true)}
			/>
			{creating ? <NewCardForm onCreate={create} onCancel={() => setCreating(false)} /> : null}
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
			{board.state.kind === "loading" ? (
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
					starting={starting}
					onSort={setSort}
					onDragEnd={onDragEnd}
					onNew={() => setCreating(true)}
				/>
			)}
		</div>
	);
}
