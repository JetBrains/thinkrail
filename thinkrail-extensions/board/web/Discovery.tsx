import { RiAddLine, RiCloseLine, RiFileTextLine, RiRadarLine } from "@remixicon/react";
import type { PanelHost } from "@thinkrail/extension-api/web";
import { useT } from "@thinkrail/locales/react";
import { Button, IconButton } from "@thinkrail/ui/button";
import { isImeComposing } from "@thinkrail/ui/keyboard";
import { LoadingRegion } from "@thinkrail/ui/skeleton";
import { Textarea } from "@thinkrail/ui/textarea";
import { cn } from "@thinkrail/ui/utils";
import { useId, useState } from "react";
import type { BoardLayout } from "./api";
import { FIELD } from "./CardParts";
import {
	createIdea,
	createWatch,
	type DiffLine,
	DOT,
	deleteWatch,
	diffHunks,
	type Idea,
	type IdeaScore,
	type IdeaStatus,
	ideaPeekEntry,
	lineDiff,
	loadDiscovery,
	MATRIX_HEIGHT,
	type MatrixLayout,
	type MatrixPoint,
	matrixLayout,
	openDiscoveryChat,
	openReport,
	QUADRANTS,
	type Quadrant,
	rankIdeas,
	SCORES,
	safeHref,
	updateWatch,
	type WatchEntry,
	type WatchSnapshot,
} from "./discoveryApi";
import { ConfirmDelete, ItemList, SavedInput, SavedTextarea } from "./Fields";
import { IDEA_STATUS_LABELS, QUADRANT_LABELS } from "./labels";
import { useBoardChanged, useHostQuery } from "./useHostQuery";
import { useWidth } from "./useWidth";

export interface DiscoveryActions {
	open: (idea: Idea) => void;
	createIdea: (title: string) => Promise<void>;
	createWatch: (input: { name: string; urls: string[]; notes: string }) => Promise<void>;
	updateWatch: (
		entry: WatchEntry,
		patch: { name?: string; urls?: string[]; notes?: string },
	) => void;
	deleteWatch: (entry: WatchEntry) => void;
	/** "What changed?": the competitor-watch chat on one entry. */
	watch: (entry: WatchEntry) => Promise<void>;
	openReport: (snapshot: WatchSnapshot) => void;
}

const STATUS_LOOKS: Readonly<Record<IdeaStatus, string>> = {
	new: "bg-control-bg-selected text-text-muted",
	analyzed: "bg-feedback-info-subtle text-feedback-info",
	promoted: "bg-feedback-success-subtle text-feedback-success",
	dismissed: "bg-control-bg text-text-subtle",
};

const QUADRANT_FILLS: Readonly<Record<Quadrant, string>> = {
	"quick-win": "fill-feedback-success-subtle",
	"big-bet": "fill-feedback-info-subtle",
	filler: "fill-control-bg",
	"time-sink": "fill-feedback-warning-subtle",
};

const DIFF_LOOKS: Readonly<Record<DiffLine["kind"], string>> = {
	added: "bg-feedback-success-subtle text-feedback-success",
	removed: "bg-feedback-error-subtle text-feedback-error",
	same: "text-text-muted",
};

const DIFF_MARKS: Readonly<Record<DiffLine["kind"], string>> = {
	added: "+",
	removed: "−",
	same: "",
};

const DIFF_LABELS = {
	added: "board.discovery.watch.diffAdded",
	removed: "board.discovery.watch.diffRemoved",
	same: "board.discovery.watch.diffSame",
} as const;

/** An idea's status as a pill. */
export function IdeaStatusChip({ status }: { status: IdeaStatus }) {
	const t = useT();
	return (
		<span
			data-testid="board-idea-status"
			data-status={status}
			className={cn("shrink-0 rounded-full px-8 tr-text-label-pill", STATUS_LOOKS[status])}
		>
			{t(IDEA_STATUS_LABELS[status])}
		</span>
	);
}

function ScoreFigure({ label, score }: { label: string; score: IdeaScore | undefined }) {
	const t = useT();
	if (!score)
		return <span className="text-text-subtle">{t("board.discovery.list.none", { label })}</span>;
	return (
		<span
			data-suggested={score.suggested || undefined}
			title={
				score.suggested
					? t("board.discovery.list.suggestedHint", { label, score: score.score })
					: undefined
			}
			className="data-[suggested]:text-text-muted"
		>
			{score.suggested
				? t("board.discovery.list.scoreSuggested", { label, score: score.score })
				: t("board.discovery.list.score", { label, score: score.score })}
		</span>
	);
}

/** The ranked list: open ideas by value then effort, then the promoted and the dismissed. */
export function IdeaList({
	ideas,
	onOpen,
}: {
	ideas: readonly Idea[];
	onOpen: (idea: Idea) => void;
}) {
	const t = useT();
	if (ideas.length === 0)
		return (
			<p data-testid="board-discovery-empty" className="p-8 tr-text-metadata text-text-subtle">
				{t("board.discovery.empty")}
			</p>
		);
	return (
		<ol data-testid="board-discovery-list" className="flex min-w-0 flex-col gap-2">
			{rankIdeas(ideas).map((idea) => (
				<li
					key={idea.id}
					data-testid="board-idea-row"
					data-idea-id={idea.id}
					data-status={idea.status}
				>
					<button
						type="button"
						aria-label={t("board.discovery.open", { id: idea.id, title: idea.title })}
						className="grid w-full min-w-0 grid-cols-[auto_minmax(0,1fr)_auto_auto] items-center gap-8 rounded-xs px-4 py-2 text-left hover:bg-control-bg-hovered focus-visible:focus-ring-inset data-[dismissed]:opacity-60"
						data-dismissed={idea.status === "dismissed" || undefined}
						onClick={() => onOpen(idea)}
					>
						<span className="tr-code-text-small text-text-muted">{idea.id}</span>
						<span className="truncate tr-text-ui text-text-default">{idea.title}</span>
						<span className="flex gap-8 tabular-nums tr-text-metadata text-text-default">
							<ScoreFigure label={t("board.discovery.list.valueShort")} score={idea.value} />
							<ScoreFigure label={t("board.discovery.list.effortShort")} score={idea.effort} />
						</span>
						<IdeaStatusChip status={idea.status} />
					</button>
				</li>
			))}
		</ol>
	);
}

function quadrantRect(layout: MatrixLayout, quadrant: Quadrant) {
	const { left, right, top, bottom, split } = layout;
	const east = quadrant === "big-bet" || quadrant === "time-sink";
	const north = quadrant === "big-bet" || quadrant === "quick-win";
	return {
		x: east ? split.x : left,
		y: north ? top : split.y,
		width: east ? right - split.x : split.x - left,
		height: north ? split.y - top : bottom - split.y,
	};
}

function MatrixDot({ point, onOpen }: { point: MatrixPoint; onOpen: (idea: Idea) => void }) {
	const t = useT();
	const { idea, x, y } = point;
	const promoted = idea.status === "promoted";
	const label = t("board.discovery.matrix.dot", {
		id: idea.id,
		title: idea.title,
		value: point.value,
		effort: point.effort,
	});
	return (
		<g
			data-testid="board-discovery-dot"
			data-idea-id={idea.id}
			data-quadrant={point.quadrant}
			data-suggested={point.suggested || undefined}
		>
			<circle
				aria-hidden
				cx={x}
				cy={y}
				r={DOT / 2 - 1}
				strokeWidth={2}
				strokeDasharray={!promoted && point.suggested ? "3 2" : undefined}
				className={
					promoted
						? "fill-feedback-success stroke-feedback-success"
						: point.suggested
							? "fill-primary-subtle stroke-primary"
							: "fill-primary stroke-primary"
				}
			/>
			<foreignObject x={x - DOT / 2} y={y - DOT / 2} width={DOT} height={DOT}>
				<button
					type="button"
					aria-label={label}
					title={point.suggested ? t("board.discovery.matrix.dotSuggested", { label }) : label}
					onClick={() => onOpen(idea)}
					className="block size-16 cursor-pointer rounded-full focus-visible:focus-ring"
				/>
			</foreignObject>
			{point.shared === 1 ? (
				<text
					aria-hidden
					x={x + DOT / 2 + 4}
					y={y + 4}
					className="pointer-events-none fill-text-muted tr-code-text-small"
				>
					{idea.id}
				</text>
			) : null}
		</g>
	);
}

/** Value × effort: the scored ideas as dots over four quadrants, a click peeking the idea. */
export function IdeaMatrix({
	ideas,
	onOpen,
	initialWidth = 360,
}: {
	ideas: readonly Idea[];
	onOpen: (idea: Idea) => void;
	/** The width drawn before the frame is measured (a server render's). */
	initialWidth?: number;
}) {
	const t = useT();
	const id = useId();
	const { width, attach } = useWidth(initialWidth);
	const layout = matrixLayout(ideas, width);
	const { left, right, top, bottom } = layout;
	return (
		<section
			data-testid="board-discovery-matrix"
			aria-labelledby={`${id}-heading`}
			className="flex min-w-0 flex-col gap-4 rounded-sm border border-border-muted bg-container-elevated-bg p-8"
		>
			<h4 id={`${id}-heading`} className="tr-text-emphasis text-text-default">
				{t("board.discovery.matrix.title")}
			</h4>
			<div ref={attach} className="min-w-0">
				{width > 0 ? (
					<svg
						aria-labelledby={`${id}-title ${id}-desc`}
						data-testid="board-discovery-svg"
						width={width}
						height={MATRIX_HEIGHT}
						viewBox={`0 0 ${width} ${MATRIX_HEIGHT}`}
						className="block overflow-visible"
					>
						<title id={`${id}-title`}>{t("board.discovery.matrix.title")}</title>
						<desc id={`${id}-desc`}>
							{t("board.discovery.matrix.desc", {
								placed: layout.points.length,
								unscored: layout.unscored.length,
							})}
						</desc>
						<g aria-hidden>
							{QUADRANTS.map((quadrant) => {
								const rect = quadrantRect(layout, quadrant);
								return (
									<g key={quadrant} data-testid="board-discovery-quadrant" data-quadrant={quadrant}>
										<rect {...rect} rx={2} className={QUADRANT_FILLS[quadrant]} />
										<text
											x={rect.x + 4}
											y={rect.y + 12}
											className="fill-text-subtle tr-text-caption"
										>
											{t(QUADRANT_LABELS[quadrant])}
										</text>
									</g>
								);
							})}
							{SCORES.map((score) => (
								<g key={score} className="fill-text-subtle tr-code-text-small">
									<text x={layout.xOf(score)} y={bottom + 14} textAnchor="middle">
										{score}
									</text>
									<text x={left - 6} y={layout.yOf(score) + 4} textAnchor="end">
										{score}
									</text>
								</g>
							))}
							<text
								x={(left + right) / 2}
								y={MATRIX_HEIGHT - 4}
								textAnchor="middle"
								className="fill-text-muted tr-text-caption"
							>
								{t("board.discovery.matrix.effortAxis")}
							</text>
							<text
								x={10}
								y={(top + bottom) / 2}
								textAnchor="middle"
								transform={`rotate(-90 10 ${(top + bottom) / 2})`}
								className="fill-text-muted tr-text-caption"
							>
								{t("board.discovery.matrix.valueAxis")}
							</text>
						</g>
						{layout.points.map((point) => (
							<MatrixDot key={point.idea.id} point={point} onOpen={onOpen} />
						))}
					</svg>
				) : (
					<div className="h-260" />
				)}
			</div>
			{layout.unscored.length > 0 ? (
				<p data-testid="board-discovery-unscored" className="tr-text-metadata text-text-subtle">
					{t("board.discovery.matrix.unscored", { count: layout.unscored.length })}
				</p>
			) : null}
		</section>
	);
}

/** The line diff between the last two snapshots, long unchanged runs folded. */
export function SnapshotDiff({ before, after }: { before: WatchSnapshot; after: WatchSnapshot }) {
	const t = useT();
	const items = diffHunks(lineDiff(before.text, after.text));
	const changed = items.some((item) => item.kind === "added" || item.kind === "removed");
	return (
		<div className="flex flex-col gap-2">
			<span className="tr-text-metadata text-text-muted">
				{t("board.discovery.watch.since", { date: new Date(before.at).toLocaleDateString() })}
			</span>
			{changed ? (
				<ol
					data-testid="board-watch-diff"
					className="flex max-h-320 flex-col overflow-auto rounded-xs border border-border-muted py-2 tr-code-text-small"
				>
					{items.map((item, index) =>
						item.kind === "skip" ? (
							<li key={`skip-${index}`} data-kind="skip" className="px-8 text-text-subtle">
								{t("board.discovery.watch.unchanged", { count: item.count })}
							</li>
						) : (
							<li
								key={`${item.kind}-${index}`}
								data-testid="board-watch-diff-line"
								data-kind={item.kind}
								className={cn("flex gap-4 px-8 whitespace-pre-wrap", DIFF_LOOKS[item.kind])}
							>
								<span aria-hidden className="w-8 shrink-0">
									{DIFF_MARKS[item.kind]}
								</span>
								<span className="sr-only">{t(DIFF_LABELS[item.kind])}</span>
								<span className="min-w-0 wrap-anywhere">{item.text}</span>
							</li>
						),
					)}
				</ol>
			) : (
				<p data-testid="board-watch-diff-none" className="tr-text-metadata text-text-subtle">
					{t("board.discovery.watch.noChange")}
				</p>
			)}
		</div>
	);
}

function UrlLink({ url }: { url: string }) {
	const href = safeHref(url);
	return href ? (
		<a
			href={href}
			target="_blank"
			rel="noreferrer"
			className="rounded-xs tr-code-text-small text-text-default underline focus-visible:focus-ring"
		>
			{url}
		</a>
	) : (
		<span className="tr-code-text-small">{url}</span>
	);
}

function WatchEntryCard({ entry, actions }: { entry: WatchEntry; actions: DiscoveryActions }) {
	const t = useT();
	const [asking, setAsking] = useState(false);
	const { snapshot, previous } = entry;
	return (
		<li
			data-testid="board-watch-entry"
			data-watch-id={entry.id}
			className="flex min-w-0 flex-col gap-8 rounded-sm border border-border-muted bg-container-elevated-bg p-8"
		>
			<div className="flex min-w-0 items-center gap-8">
				<span className="tr-code-text-small text-text-muted">{entry.id}</span>
				<div className="min-w-0 flex-1">
					<SavedInput
						key={entry.name}
						compact
						value={entry.name}
						label={t("board.discovery.watch.name")}
						testId="board-watch-name"
						onSave={(name) => actions.updateWatch(entry, { name })}
					/>
				</div>
				<Button
					variant="soft-primary"
					size="s"
					iconLeft={RiRadarLine}
					loading={asking}
					data-testid="board-watch-changed"
					onClick={() => {
						setAsking(true);
						void actions.watch(entry).finally(() => setAsking(false));
					}}
				>
					{t("board.discovery.chat.watch")}
				</Button>
				<ConfirmDelete
					label={t("board.discovery.watch.delete")}
					question={t("board.discovery.watch.deleteConfirm")}
					testId="board-watch-delete"
					onDelete={() => actions.deleteWatch(entry)}
				/>
			</div>
			<ItemList
				items={entry.urls}
				label={t("board.discovery.watch.urls")}
				addLabel={t("board.discovery.watch.addUrl")}
				testId="board-watch-urls"
				renderItem={(url) => <UrlLink url={url} />}
				onChange={(urls) => actions.updateWatch(entry, { urls })}
			/>
			<SavedTextarea
				key={entry.notes}
				value={entry.notes}
				label={t("board.discovery.watch.notes")}
				testId="board-watch-notes"
				placeholder={t("board.discovery.watch.notesPlaceholder")}
				onSave={(notes) => actions.updateWatch(entry, { notes })}
			/>
			{snapshot ? (
				<div data-testid="board-watch-snapshot" className="flex min-w-0 flex-col gap-4">
					<span className="flex flex-wrap items-center gap-8 tr-text-metadata text-text-muted">
						{t("board.discovery.watch.lastSnapshot", {
							date: new Date(snapshot.at).toLocaleDateString(),
						})}
						{snapshot.artifactPath ? (
							<Button
								variant="ghost"
								size="s"
								iconLeft={RiFileTextLine}
								data-testid="board-watch-report"
								onClick={() => actions.openReport(snapshot)}
							>
								{t("board.discovery.watch.report")}
							</Button>
						) : null}
					</span>
					<details className="min-w-0">
						<summary className="cursor-pointer rounded-xs tr-text-metadata text-text-muted focus-visible:focus-ring">
							{t("board.discovery.watch.snapshotText")}
						</summary>
						<pre
							data-testid="board-watch-snapshot-text"
							className="max-h-240 overflow-auto whitespace-pre-wrap pt-4 tr-code-text-small text-text-default"
						>
							{snapshot.text}
						</pre>
					</details>
					{previous ? <SnapshotDiff before={previous} after={snapshot} /> : null}
				</div>
			) : (
				<p className="tr-text-metadata text-text-subtle">{t("board.discovery.watch.noSnapshot")}</p>
			)}
		</li>
	);
}

function NewWatchForm({
	onCreate,
	onCancel,
}: {
	onCreate: (input: { name: string; urls: string[]; notes: string }) => Promise<void>;
	onCancel: () => void;
}) {
	const t = useT();
	const id = useId();
	const [name, setName] = useState("");
	const [urls, setUrls] = useState("");
	const [notes, setNotes] = useState("");
	const [busy, setBusy] = useState(false);
	const submit = () => {
		const trimmed = name.trim();
		if (!trimmed || busy) return;
		setBusy(true);
		void onCreate({
			name: trimmed,
			urls: urls
				.split(/[\s,]+/)
				.map((url) => url.trim())
				.filter(Boolean),
			notes: notes.trim(),
		}).finally(() => setBusy(false));
	};
	return (
		<form
			data-testid="board-watch-new-form"
			className="flex flex-col gap-4 rounded-sm border border-border-muted p-8"
			onSubmit={(event) => {
				event.preventDefault();
				submit();
			}}
		>
			<input
				data-testid="board-watch-new-name"
				aria-label={t("board.discovery.watch.name")}
				placeholder={t("board.discovery.watch.namePlaceholder")}
				value={name}
				onChange={(event) => setName(event.currentTarget.value)}
				onKeyDown={(event) => {
					if (event.key !== "Escape" || isImeComposing(event.nativeEvent)) return;
					event.preventDefault();
					onCancel();
				}}
				ref={(node) => node?.focus()}
				className={FIELD}
			/>
			<label htmlFor={`${id}-urls`} className="sr-only">
				{t("board.discovery.watch.urls")}
			</label>
			<input
				id={`${id}-urls`}
				data-testid="board-watch-new-urls"
				placeholder={t("board.discovery.watch.urlsPlaceholder")}
				value={urls}
				onChange={(event) => setUrls(event.currentTarget.value)}
				className={FIELD}
			/>
			<Textarea
				data-testid="board-watch-new-notes"
				aria-label={t("board.discovery.watch.notes")}
				placeholder={t("board.discovery.watch.notesPlaceholder")}
				rows={2}
				value={notes}
				onChange={(event) => setNotes(event.currentTarget.value)}
			/>
			<span className="flex gap-4">
				<Button type="submit" size="s" loading={busy} disabled={!name.trim()}>
					{t("board.discovery.watch.add")}
				</Button>
				<Button variant="ghost" size="s" onClick={onCancel}>
					{t("board.newCard.cancel")}
				</Button>
			</span>
		</form>
	);
}

function NewIdeaForm({
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
			data-testid="board-idea-new-form"
			className="flex items-center gap-4"
			onSubmit={(event) => {
				event.preventDefault();
				submit();
			}}
		>
			<input
				data-testid="board-idea-new-title"
				aria-label={t("board.discovery.newTitle")}
				placeholder={t("board.discovery.newPlaceholder")}
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

/** The Discovery view: ideas as a ranked list beside the value × effort matrix, then the watchlist. */
export function DiscoveryView({
	ideas,
	watchlist,
	layout,
	actions,
}: {
	ideas: readonly Idea[];
	watchlist: readonly WatchEntry[];
	layout: BoardLayout;
	actions: DiscoveryActions;
}) {
	const t = useT();
	const [addingIdea, setAddingIdea] = useState(false);
	const [addingWatch, setAddingWatch] = useState(false);
	return (
		<div
			data-testid="board-discovery"
			className="flex min-h-0 flex-1 flex-col gap-16 overflow-auto p-8"
		>
			<section data-testid="board-discovery-ideas" className="flex min-w-0 flex-col gap-8">
				<h3 className="flex items-center gap-8">
					<span className="tr-text-emphasis text-text-default">{t("board.discovery.ideas")}</span>
					<span className="tabular-nums tr-text-metadata text-text-subtle">{ideas.length}</span>
					<span className="ml-auto">
						{addingIdea ? null : (
							<Button
								variant="ghost"
								size="s"
								iconLeft={RiAddLine}
								data-testid="board-idea-new"
								onClick={() => setAddingIdea(true)}
							>
								{t("board.discovery.new")}
							</Button>
						)}
					</span>
				</h3>
				{addingIdea ? (
					<NewIdeaForm
						onCreate={async (title) => {
							await actions.createIdea(title);
							setAddingIdea(false);
						}}
						onCancel={() => setAddingIdea(false)}
					/>
				) : null}
				<div
					className={cn(
						"min-w-0",
						layout === "columns" ? "grid grid-cols-2 items-start gap-12" : "flex flex-col gap-12",
					)}
				>
					<IdeaMatrix ideas={ideas} onOpen={actions.open} />
					<IdeaList ideas={ideas} onOpen={actions.open} />
				</div>
			</section>
			<section data-testid="board-watchlist" className="flex min-w-0 flex-col gap-8">
				<h3 className="flex items-center gap-8">
					<span className="tr-text-emphasis text-text-default">
						{t("board.discovery.watch.title")}
					</span>
					<span className="truncate tr-text-metadata text-text-subtle">
						{t("board.discovery.watch.hint")}
					</span>
					<span className="ml-auto">
						{addingWatch ? null : (
							<Button
								variant="ghost"
								size="s"
								iconLeft={RiAddLine}
								data-testid="board-watch-new"
								onClick={() => setAddingWatch(true)}
							>
								{t("board.discovery.watch.new")}
							</Button>
						)}
					</span>
				</h3>
				{addingWatch ? (
					<NewWatchForm
						onCreate={async (input) => {
							await actions.createWatch(input);
							setAddingWatch(false);
						}}
						onCancel={() => setAddingWatch(false)}
					/>
				) : null}
				{watchlist.length === 0 && !addingWatch ? (
					<p className="tr-text-metadata text-text-subtle">{t("board.discovery.watch.empty")}</p>
				) : (
					<ul className="flex flex-col gap-8">
						{watchlist.map((entry) => (
							<WatchEntryCard key={entry.id} entry={entry} actions={actions} />
						))}
					</ul>
				)}
			</section>
		</div>
	);
}

/**
 * The Roadmap area's Discovery view: the board's `discovery.get`, re-read on `board.changed`; an idea
 * opens in Peek, "What changed?" opens the competitor-watch chat.
 */
export function DiscoveryPane({
	host,
	layout,
	onError,
}: {
	host: PanelHost;
	layout: BoardLayout;
	onError: (error: unknown) => void;
}) {
	const t = useT();
	const { workspaceId, projectId } = host.scope;
	const discovery = useHostQuery(`discovery:${workspaceId}:${projectId}`, (signal) =>
		loadDiscovery(host, projectId, signal),
	);
	useBoardChanged(host, projectId, discovery.reload);
	const write = (run: () => Promise<unknown>) =>
		run().then(discovery.reload, (error: unknown) => {
			onError(error);
			discovery.reload();
		});
	const actions: DiscoveryActions = {
		open: (idea) => host.peek(ideaPeekEntry(projectId, idea)),
		createIdea: async (title) => {
			try {
				const created = await createIdea(host, projectId, title);
				discovery.reload();
				host.peek(ideaPeekEntry(projectId, created));
			} catch (error) {
				onError(error);
			}
		},
		createWatch: async (input) => {
			await write(() => createWatch(host, projectId, input));
		},
		updateWatch: (entry, patch) => void write(() => updateWatch(host, projectId, entry.id, patch)),
		deleteWatch: (entry) => void write(() => deleteWatch(host, projectId, entry.id)),
		watch: (entry) =>
			openDiscoveryChat(host, projectId, "watch", { watchId: entry.id }).then((started) => {
				if (started.kickoffError)
					onError(new Error(t("board.roadmap.chat.notSent", { error: started.kickoffError })));
			}, onError),
		openReport: (snapshot) => {
			if (snapshot.artifactPath)
				openReport(host, projectId, {
					path: snapshot.artifactPath,
					...(snapshot.workspaceId ? { workspaceId: snapshot.workspaceId } : {}),
				});
		},
	};
	if (discovery.state.kind === "loading")
		return (
			<LoadingRegion
				rows={6}
				label={t("board.loading")}
				testId="board-discovery-loading"
				className="min-h-0 flex-1 overflow-hidden p-8"
			/>
		);
	if (discovery.state.kind === "error")
		return (
			<div
				data-testid="board-discovery-error"
				className="flex flex-1 flex-col items-center justify-center gap-8 p-16 text-center"
			>
				<span className="tr-text-ui text-text-muted">{t("board.discovery.loadError")}</span>
				<span className="tr-text-metadata text-text-subtle wrap-anywhere">
					{discovery.state.message}
				</span>
				<Button variant="outline" size="m" onClick={discovery.reload}>
					{t("board.retry")}
				</Button>
			</div>
		);
	return (
		<DiscoveryView
			ideas={discovery.state.value.ideas}
			watchlist={discovery.state.value.watchlist}
			layout={layout}
			actions={actions}
		/>
	);
}
