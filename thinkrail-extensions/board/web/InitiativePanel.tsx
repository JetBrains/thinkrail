import {
	RiAddLine,
	RiChat3Line,
	RiCheckLine,
	RiCloseLine,
	RiDeleteBinLine,
	RiDiscussLine,
	RiEditLine,
	RiListCheck3,
	RiQuillPenLine,
	RiSendPlaneLine,
	RiShapesLine,
} from "@remixicon/react";
import type { PanelHost, PanelProps } from "@thinkrail/extension-api/web";
import { type Translator, useT } from "@thinkrail/locales/react";
import { Button, IconButton } from "@thinkrail/ui/button";
import { LoadingRegion } from "@thinkrail/ui/skeleton";
import { Textarea } from "@thinkrail/ui/textarea";
import { cn } from "@thinkrail/ui/utils";
import { type ReactNode, useId, useState } from "react";
import {
	agentBadge,
	type BoardView,
	type Card,
	cardPeekEntry,
	loadBoard,
	openAttempt,
	shownId,
} from "./api";
import { AgentBadgeChip, FIELD, LastActionLine } from "./CardParts";
import { ClearableInput, ItemList, SavedInput, SavedTextarea, Section } from "./Fields";
import {
	CATEGORY_LABELS,
	columnTitle,
	dayText,
	FORECAST_MISSES,
	HEALTH_LABELS,
	HORIZON_LABELS,
	healthReasonText,
	ROADMAP_CHAT_LABELS,
} from "./labels";
import { HealthChip, HorizonChip, ProgressLegend, StackBar } from "./RoadmapParts";
import {
	acceptInitiative,
	addInitiativeCards,
	appetiteUsed,
	assignCard,
	createMilestone,
	createRoadmapProject,
	deleteInitiative,
	deleteMilestone,
	deleteRoadmapProject,
	draftUpdate,
	HEALTHS,
	type Health,
	HORIZONS,
	type Initiative,
	type InitiativePatch,
	loadRoadmap,
	type Milestone,
	openRoadmapChat,
	parentOptions,
	publishDraftUpdate,
	type RoadmapChat,
	type RoadmapProject,
	type RoadmapView,
	removeInitiativeCards,
	renameRoadmapProject,
	saveDraftUpdate,
	updateInitiative,
	updateMilestone,
} from "./roadmapApi";
import { useBoardChanged, useHostQuery } from "./useHostQuery";

type Write = (run: () => Promise<unknown>) => void;

/** A delete behind an inline confirm; `wide` shows its label beside the icon. */
function ConfirmDelete({
	label,
	question,
	testId,
	wide = false,
	onDelete,
}: {
	label: string;
	question: string;
	testId: string;
	wide?: boolean;
	onDelete: () => void;
}) {
	const t = useT();
	const [confirming, setConfirming] = useState(false);
	return confirming ? (
		<span className="flex flex-wrap items-center gap-4">
			<span className="tr-text-metadata text-text-muted">{question}</span>
			<Button
				variant="destructive"
				size="s"
				data-testid={`${testId}-confirm`}
				onClick={() => {
					setConfirming(false);
					onDelete();
				}}
			>
				{label}
			</Button>
			<Button variant="ghost" size="s" onClick={() => setConfirming(false)}>
				{t("board.card.keep")}
			</Button>
		</span>
	) : wide ? (
		<Button
			variant="ghost"
			size="s"
			tone="danger"
			iconLeft={RiDeleteBinLine}
			data-testid={testId}
			className="self-start"
			onClick={() => setConfirming(true)}
		>
			{label}
		</Button>
	) : (
		<IconButton
			icon={RiDeleteBinLine}
			size="s"
			label={label}
			data-testid={testId}
			onClick={() => setConfirming(true)}
		/>
	);
}

/** A select of the board's cards to add somewhere, offering only those `available` lets through. */
function CardPicker({
	board,
	label,
	testId,
	available,
	onPick,
}: {
	board: BoardView | null;
	label: string;
	testId: string;
	available: (card: Card) => boolean;
	onPick: (cardId: string) => void;
}) {
	const t = useT();
	const id = useId();
	const cards = (board?.cards ?? []).filter((card) => !card.virtual && available(card));
	return (
		<>
			<label htmlFor={id} className="sr-only">
				{label}
			</label>
			<select
				id={id}
				data-testid={testId}
				value=""
				disabled={cards.length === 0}
				onChange={(event) => {
					const picked = event.currentTarget.value;
					if (picked) onPick(picked);
				}}
				className={FIELD}
			>
				<option value="">{label}</option>
				{cards.map((card) => (
					<option key={card.id} value={card.id}>
						{t("board.card.blockOption", { id: card.id, title: card.title })}
					</option>
				))}
			</select>
		</>
	);
}

function MilestoneRow({
	projectId,
	milestone,
	host,
	write,
}: {
	projectId: string;
	milestone: Milestone;
	host: PanelHost;
	write: Write;
}) {
	const t = useT();
	return (
		<li
			data-testid="board-initiative-milestone"
			data-milestone-id={milestone.id}
			className="flex min-w-0 items-center gap-4"
		>
			<SavedInput
				key={milestone.title}
				compact
				value={milestone.title}
				label={t("board.roadmap.milestoneTitle")}
				testId="board-initiative-milestone-title"
				onSave={(title) => write(() => updateMilestone(host, projectId, milestone.id, { title }))}
			/>
			<ClearableInput
				key={milestone.target ?? ""}
				type="date"
				value={milestone.target ?? ""}
				label={t("board.roadmap.milestoneTarget")}
				testId="board-initiative-milestone-target"
				onSave={(target) => write(() => updateMilestone(host, projectId, milestone.id, { target }))}
			/>
			<ConfirmDelete
				label={t("board.roadmap.milestoneDelete")}
				question={t("board.roadmap.milestoneDeleteConfirm")}
				testId="board-initiative-milestone-delete"
				onDelete={() => write(() => deleteMilestone(host, projectId, milestone.id))}
			/>
		</li>
	);
}

function AddField({
	label,
	testId,
	onAdd,
}: {
	label: string;
	testId: string;
	onAdd: (title: string) => void;
}) {
	const [draft, setDraft] = useState("");
	return (
		<form
			className="flex items-center gap-4"
			onSubmit={(event) => {
				event.preventDefault();
				const title = draft.trim();
				if (!title) return;
				onAdd(title);
				setDraft("");
			}}
		>
			<input
				data-testid={testId}
				aria-label={label}
				placeholder={label}
				value={draft}
				onChange={(event) => setDraft(event.currentTarget.value)}
				className={FIELD}
			/>
			<IconButton icon={RiAddLine} size="s" type="submit" label={label} disabled={!draft.trim()} />
		</form>
	);
}

function ProjectBlock({
	host,
	view,
	board,
	project,
	write,
}: {
	host: PanelHost;
	view: RoadmapView;
	board: BoardView | null;
	project: RoadmapProject;
	write: Write;
}) {
	const t = useT();
	const { projectId } = view;
	const cards = (board?.cards ?? []).filter((card) => card.roadmapProjectId === project.id);
	return (
		<li
			data-testid="board-initiative-project"
			data-project-id={project.id}
			className="flex flex-col gap-4 rounded-sm border border-border-muted p-8"
		>
			<span className="flex min-w-0 items-center gap-4">
				<SavedInput
					key={project.title}
					compact
					value={project.title}
					label={t("board.roadmap.projectTitle")}
					testId="board-initiative-project-title"
					onSave={(title) => write(() => renameRoadmapProject(host, projectId, project.id, title))}
				/>
				<span className="shrink-0 tabular-nums tr-text-metadata text-text-muted">
					{t("board.roadmap.projectCards", { count: cards.length })}
				</span>
				<ConfirmDelete
					label={t("board.roadmap.projectDelete")}
					question={t("board.roadmap.projectDeleteConfirm")}
					testId="board-initiative-project-delete"
					onDelete={() => write(() => deleteRoadmapProject(host, projectId, project.id))}
				/>
			</span>
			<StackBar rollup={view.rollups.projects[project.id]} />
			{project.milestones.length > 0 ? (
				<ul className="flex flex-col gap-2">
					{project.milestones.map((milestone) => (
						<MilestoneRow
							key={milestone.id}
							projectId={projectId}
							milestone={milestone}
							host={host}
							write={write}
						/>
					))}
				</ul>
			) : null}
			<AddField
				label={t("board.roadmap.milestoneAdd")}
				testId="board-initiative-milestone-add"
				onAdd={(title) => write(() => createMilestone(host, projectId, project.id, title))}
			/>
			<CardPicker
				board={board}
				label={t("board.roadmap.projectAssign")}
				testId="board-initiative-project-assign"
				available={(card) => card.roadmapProjectId !== project.id}
				onPick={(cardId) => write(() => assignCard(host, cardId, { roadmapProjectId: project.id }))}
			/>
		</li>
	);
}

/** The initiative's cards with live badges: this board's (direct ones removable) and other boards'. */
function MemberCards({
	host,
	view,
	board,
	initiative,
	write,
}: {
	host: PanelHost;
	view: RoadmapView;
	board: BoardView | null;
	initiative: Initiative;
	write: Write;
}) {
	const t = useT();
	const { projectId } = view;
	const byId = new Map((board?.cards ?? []).map((card) => [card.id, card]));
	const external = view.externalCards.filter((card) =>
		initiative.memberExternalCards.some((ref) => ref.cardId === card.cardId),
	);
	const remove = (cardId: string) =>
		write(() => removeInitiativeCards(host, projectId, initiative.id, [cardId]));
	return (
		<div className="flex flex-col gap-4">
			<ul data-testid="board-initiative-cards" className="flex flex-col gap-2">
				{initiative.memberCardIds.map((cardId) => {
					const card = byId.get(cardId);
					return (
						<li
							key={cardId}
							data-testid="board-initiative-card"
							data-card-id={cardId}
							className="flex min-w-0 items-center gap-4"
						>
							<button
								type="button"
								className="flex min-w-0 flex-1 items-center gap-4 rounded-xs text-left focus-visible:focus-ring"
								onClick={() => card && host.peek(cardPeekEntry(projectId, card))}
							>
								<span className="shrink-0 tr-code-text-small text-text-muted">
									{card ? shownId(card) : cardId}
								</span>
								<span className="min-w-0 truncate tr-text-ui text-text-default">
									{card?.title ?? ""}
								</span>
								{card ? (
									<span className="shrink-0 tr-text-metadata text-text-subtle">
										{columnTitle(t, card.column)}
									</span>
								) : null}
								{card ? <AgentBadgeChip badge={agentBadge(card)} /> : null}
							</button>
							{initiative.cardIds.includes(cardId) ? (
								<IconButton
									icon={RiCloseLine}
									size="s"
									label={t("board.card.removeItem", { item: cardId })}
									onClick={() => remove(cardId)}
								/>
							) : null}
						</li>
					);
				})}
				{external.map((card) => (
					<li
						key={card.cardId}
						data-testid="board-initiative-card"
						data-card-id={card.cardId}
						data-external
						className="flex min-w-0 items-center gap-4"
					>
						<button
							type="button"
							className="flex min-w-0 flex-1 items-center gap-4 rounded-xs text-left focus-visible:focus-ring"
							onClick={() =>
								host.peek(
									cardPeekEntry(card.projectId, {
										id: card.cardId,
										title: card.missing ? card.cardId : card.title,
										source: { kind: "native", ref: card.cardId },
									}),
								)
							}
						>
							<span className="shrink-0 tr-code-text-small text-text-muted">{card.cardId}</span>
							<span className="min-w-0 truncate tr-text-ui text-text-default">
								{card.missing ? t("board.roadmap.cardMissing") : card.title}
							</span>
							<span
								data-testid="board-initiative-card-external"
								className="shrink-0 rounded-xs bg-control-bg-selected px-4 tr-text-metadata text-text-muted"
							>
								{t("board.roadmap.external", { project: card.projectName ?? card.projectId })}
							</span>
							{card.missing ? null : (
								<span className="shrink-0 tr-text-metadata text-text-subtle">
									{t(CATEGORY_LABELS[card.category])}
								</span>
							)}
						</button>
						{initiative.externalCards.some((ref) => ref.cardId === card.cardId) ? (
							<IconButton
								icon={RiCloseLine}
								size="s"
								label={t("board.card.removeItem", { item: card.cardId })}
								onClick={() => remove(card.cardId)}
							/>
						) : null}
					</li>
				))}
			</ul>
			{initiative.memberCardIds.length + external.length === 0 ? (
				<span className="tr-text-metadata text-text-subtle">{t("board.roadmap.noCards")}</span>
			) : null}
			<CardPicker
				board={board}
				label={t("board.roadmap.addCard")}
				testId="board-initiative-add-card"
				available={(card) => !initiative.memberCardIds.includes(card.id)}
				onPick={(cardId) =>
					write(() => addInitiativeCards(host, projectId, initiative.id, [cardId]))
				}
			/>
		</div>
	);
}

/** The member cards whose agent works, waits for the human or failed, each one click from its chat. */
function AgentsNow({
	host,
	board,
	initiative,
}: {
	host: PanelHost;
	board: BoardView | null;
	initiative: Initiative;
}) {
	const t = useT();
	const members = new Set(initiative.memberCardIds);
	const rows = (board?.cards ?? []).filter((card) => {
		const badge = agentBadge(card);
		return (
			members.has(card.id) && (badge === "working" || badge === "waiting" || badge === "failed")
		);
	});
	if (rows.length === 0)
		return (
			<span className="tr-text-metadata text-text-subtle">{t("board.roadmap.agentsNone")}</span>
		);
	return (
		<ul data-testid="board-initiative-agents" className="flex flex-col gap-4">
			{rows.map((card) => {
				const badge = agentBadge(card);
				const attempt = openAttempt(card);
				return (
					<li
						key={card.id}
						data-testid="board-initiative-agent"
						data-card-id={card.id}
						className="flex min-w-0 flex-col gap-2"
					>
						<span className="flex min-w-0 items-center gap-4">
							<AgentBadgeChip badge={badge} />
							<span className="shrink-0 tr-code-text-small text-text-muted">{card.id}</span>
							<span className="min-w-0 flex-1 truncate tr-text-ui text-text-default">
								{card.title}
							</span>
							{attempt ? (
								<Button
									variant={badge === "waiting" ? "primary" : "ghost"}
									size="s"
									iconLeft={RiChat3Line}
									onClick={() =>
										host.openChat({
											projectId: board?.projectId ?? host.scope.projectId,
											workspaceId: attempt.workspaceId,
											sessionId: attempt.sessionId,
										})
									}
								>
									{badge === "waiting" ? t("board.inbox.answer") : t("board.attempts.openChat")}
								</Button>
							) : null}
						</span>
						<LastActionLine action={badge === "working" ? attempt?.chat?.lastAction : undefined} />
					</li>
				);
			})}
		</ul>
	);
}

function ForecastBlock({ view, initiative }: { view: RoadmapView; initiative: Initiative }) {
	const t = useT();
	const forecast = view.forecast[initiative.id];
	const appetite = appetiteUsed(initiative, view.rollups.initiatives[initiative.id]);
	return (
		<div data-testid="board-initiative-forecast" className="flex flex-col gap-4">
			<dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-12 gap-y-2 tr-text-ui">
				<dt className="text-text-muted">{t("board.roadmap.target")}</dt>
				<dd className="text-text-default">
					{initiative.target ? dayText(initiative.target) : t("board.roadmap.noTarget")}
				</dd>
				<dt className="text-text-muted">{t("board.roadmap.forecast.title")}</dt>
				<dd data-testid="board-initiative-forecast-value" data-status={forecast?.status}>
					{forecast?.status === "ok" ? (
						<span className="text-text-default">
							{t("board.roadmap.forecast.dates", {
								p50: dayText(forecast.p50),
								p85: dayText(forecast.p85),
							})}
						</span>
					) : forecast?.status === "done" ? (
						<span className="text-feedback-success">{t("board.roadmap.forecast.done")}</span>
					) : forecast ? (
						<span className="flex flex-col text-text-muted">
							<span>{t("board.roadmap.forecast.insufficient")}</span>
							<span className="tr-text-metadata text-text-subtle">
								{t(FORECAST_MISSES[forecast.reason])}
							</span>
						</span>
					) : null}
				</dd>
				<dt className="text-text-muted">{t("board.roadmap.appetiteTitle")}</dt>
				<dd className="text-text-default tabular-nums">
					{appetite
						? t("board.roadmap.appetite", { used: appetite.used, days: appetite.appetite })
						: t("board.roadmap.noAppetite")}
				</dd>
			</dl>
			{appetite ? (
				<progress
					data-testid="board-initiative-appetite-bar"
					value={appetite.percent}
					max={100}
					aria-label={t("board.roadmap.appetite", {
						used: appetite.used,
						days: appetite.appetite,
					})}
					className={cn(
						"h-4 w-full appearance-none overflow-hidden rounded-xs bg-control-bg-hovered [&::-webkit-progress-bar]:bg-control-bg-hovered",
						appetite.percent > 80
							? "accent-feedback-warning [&::-moz-progress-bar]:bg-feedback-warning [&::-webkit-progress-value]:bg-feedback-warning"
							: "accent-feedback-info [&::-moz-progress-bar]:bg-feedback-info [&::-webkit-progress-value]:bg-feedback-info",
					)}
				/>
			) : null}
		</div>
	);
}

function HealthBlock({
	view,
	initiative,
	onPatch,
}: {
	view: RoadmapView;
	initiative: Initiative;
	onPatch: (patch: InitiativePatch) => void;
}) {
	const t = useT();
	const id = useId();
	const health = view.health[initiative.id];
	return (
		<div className="flex flex-col gap-4">
			<span className="flex flex-wrap items-center gap-8">
				<HealthChip health={health} />
				{health?.override ? (
					<span className="tr-text-metadata text-text-subtle">
						{t("board.roadmap.health.suggestedWas", { health: t(HEALTH_LABELS[health.suggested]) })}
					</span>
				) : null}
			</span>
			{health && health.reasons.length > 0 ? (
				<ul data-testid="board-initiative-reasons" className="flex flex-col gap-2">
					{health.reasons.map((reason) => (
						<li
							key={reason.kind}
							data-reason={reason.kind}
							className={cn(
								"tr-text-metadata",
								reason.level === "off_track" ? "text-feedback-error" : "text-feedback-warning",
							)}
						>
							{healthReasonText(t, reason)}
						</li>
					))}
				</ul>
			) : (
				<span className="tr-text-metadata text-text-subtle">
					{t("board.roadmap.health.noReasons")}
				</span>
			)}
			<div className="flex flex-wrap items-end gap-8">
				<label htmlFor={`${id}-override`} className="flex flex-col gap-2">
					<span className="tr-text-metadata text-text-muted">
						{t("board.roadmap.health.override")}
					</span>
					<select
						id={`${id}-override`}
						data-testid="board-initiative-health-override"
						value={initiative.health?.override ?? ""}
						onChange={(event) => {
							const override = HEALTHS.find((value) => value === event.currentTarget.value);
							onPatch({ health: { override: override ?? null } });
						}}
						className={FIELD}
					>
						<option value="">{t("board.roadmap.health.useSuggested")}</option>
						{HEALTHS.map((value) => (
							<option key={value} value={value}>
								{t(HEALTH_LABELS[value])}
							</option>
						))}
					</select>
				</label>
				<label className="flex min-w-0 flex-1 flex-col gap-2">
					<span className="tr-text-metadata text-text-muted">{t("board.roadmap.health.note")}</span>
					<input
						key={initiative.health?.note ?? ""}
						data-testid="board-initiative-health-note"
						defaultValue={initiative.health?.note ?? ""}
						placeholder={t("board.roadmap.health.notePlaceholder")}
						onBlur={(event) => {
							const note = event.currentTarget.value.trim();
							if (note !== (initiative.health?.note ?? ""))
								onPatch({ health: { note: note || null } });
						}}
						className={FIELD}
					/>
				</label>
			</div>
		</div>
	);
}

function DraftUpdateBlock({
	host,
	view,
	initiative,
	write,
}: {
	host: PanelHost;
	view: RoadmapView;
	initiative: Initiative;
	write: Write;
}) {
	const t = useT();
	const draft = draftUpdate(initiative);
	const [editing, setEditing] = useState<{ text: string; health: Health } | null>(null);
	if (!draft) return null;
	const { projectId } = view;
	return (
		<div
			data-testid="board-initiative-draft"
			className="flex flex-col gap-4 rounded-sm border border-border-muted bg-control-bg p-8"
		>
			<span className="tr-text-metadata text-text-muted">
				{t("board.roadmap.draft.title", { date: new Date(draft.at).toLocaleString() })}
			</span>
			{editing ? (
				<>
					<Textarea
						data-testid="board-initiative-draft-text"
						aria-label={t("board.roadmap.draft.text")}
						rows={6}
						value={editing.text}
						onChange={(event) => setEditing({ ...editing, text: event.currentTarget.value })}
					/>
					<select
						aria-label={t("board.roadmap.draft.health")}
						data-testid="board-initiative-draft-health"
						value={editing.health}
						onChange={(event) => {
							const health = HEALTHS.find((value) => value === event.currentTarget.value);
							if (health) setEditing({ ...editing, health });
						}}
						className={FIELD}
					>
						{HEALTHS.map((value) => (
							<option key={value} value={value}>
								{t(HEALTH_LABELS[value])}
							</option>
						))}
					</select>
				</>
			) : (
				<>
					<p className="whitespace-pre-wrap tr-text-ui text-text-default wrap-anywhere">
						{draft.text}
					</p>
					<span className="tr-text-metadata text-text-muted">
						{t("board.roadmap.draft.healthIs", { health: t(HEALTH_LABELS[draft.health]) })}
					</span>
				</>
			)}
			<span className="flex flex-wrap gap-4">
				{editing ? (
					<>
						<Button
							variant="primary"
							size="s"
							iconLeft={RiCheckLine}
							data-testid="board-initiative-draft-save"
							disabled={!editing.text.trim()}
							onClick={() => {
								const { text, health } = editing;
								setEditing(null);
								write(() => saveDraftUpdate(host, projectId, initiative.id, text.trim(), health));
							}}
						>
							{t("board.settings.save")}
						</Button>
						<Button variant="ghost" size="s" onClick={() => setEditing(null)}>
							{t("board.newCard.cancel")}
						</Button>
					</>
				) : (
					<>
						<Button
							variant="primary"
							size="s"
							iconLeft={RiSendPlaneLine}
							data-testid="board-initiative-draft-publish"
							onClick={() => write(() => publishDraftUpdate(host, projectId, initiative.id))}
						>
							{t("board.roadmap.draft.publish")}
						</Button>
						<Button
							variant="ghost"
							size="s"
							iconLeft={RiEditLine}
							data-testid="board-initiative-draft-edit"
							onClick={() => setEditing({ text: draft.text, health: draft.health })}
						>
							{t("board.roadmap.draft.edit")}
						</Button>
					</>
				)}
			</span>
		</div>
	);
}

const CHAT_ICONS = {
	plan: RiListCheck3,
	shape: RiShapesLine,
	report: RiQuillPenLine,
	review: RiDiscussLine,
} as const satisfies Record<RoadmapChat, unknown>;

function AgentActions({
	host,
	view,
	initiative,
	onError,
}: {
	host: PanelHost;
	view: RoadmapView;
	initiative: Initiative;
	onError: (message: string) => void;
}) {
	const t = useT();
	const [starting, setStarting] = useState<RoadmapChat | null>(null);
	const start = (kind: RoadmapChat) => {
		setStarting(kind);
		openRoadmapChat(host, view.projectId, kind, initiative.id)
			.then(
				(started) => {
					if (started.kickoffError)
						onError(t("board.roadmap.chat.notSent", { error: started.kickoffError }));
				},
				(error: unknown) => onError(errorText(t, error)),
			)
			.finally(() => setStarting(null));
	};
	return (
		<div className="flex flex-col gap-4">
			<span className="flex flex-wrap gap-4">
				{(["plan", "shape", "report", "review"] as const).map((kind) => (
					<Button
						key={kind}
						variant={kind === "plan" ? "soft-primary" : "outline"}
						size="s"
						iconLeft={CHAT_ICONS[kind]}
						loading={starting === kind}
						disabled={starting !== null && starting !== kind}
						data-testid={`board-initiative-chat-${kind}`}
						onClick={() => start(kind)}
					>
						{t(ROADMAP_CHAT_LABELS[kind])}
					</Button>
				))}
			</span>
			<span className="tr-text-metadata text-text-subtle">{t("board.roadmap.chat.hint")}</span>
		</div>
	);
}

function errorText(t: Translator, error: unknown): string {
	return error instanceof Error && error.message ? error.message : t("board.error.unknown");
}

/** The initiative's editable facts: title, outcome, horizon, target, appetite and parent. */
function InitiativeFacts({
	view,
	initiative,
	onPatch,
}: {
	view: RoadmapView;
	initiative: Initiative;
	onPatch: (patch: InitiativePatch) => void;
}) {
	const t = useT();
	const id = useId();
	return (
		<>
			<div className="flex flex-wrap items-end gap-8">
				<label htmlFor={`${id}-horizon`} className="flex flex-col gap-2">
					<span className="tr-text-metadata text-text-muted">
						{t("board.roadmap.horizonLabel")}
					</span>
					<select
						id={`${id}-horizon`}
						data-testid="board-initiative-horizon"
						value={initiative.horizon}
						onChange={(event) => {
							const horizon = HORIZONS.find((value) => value === event.currentTarget.value);
							if (horizon) onPatch({ horizon });
						}}
						className={FIELD}
					>
						{HORIZONS.map((horizon) => (
							<option key={horizon} value={horizon}>
								{t(HORIZON_LABELS[horizon])}
							</option>
						))}
					</select>
				</label>
				<label htmlFor={`${id}-target`} className="flex flex-col gap-2">
					<span className="tr-text-metadata text-text-muted">{t("board.roadmap.target")}</span>
					<ClearableInput
						id={`${id}-target`}
						key={initiative.target ?? ""}
						type="date"
						value={initiative.target ?? ""}
						label={t("board.roadmap.target")}
						testId="board-initiative-target"
						onSave={(target) => onPatch({ target })}
					/>
				</label>
				<label htmlFor={`${id}-appetite`} className="flex flex-col gap-2">
					<span className="tr-text-metadata text-text-muted">
						{t("board.roadmap.appetiteDays")}
					</span>
					<ClearableInput
						id={`${id}-appetite`}
						key={initiative.appetiteDays ?? ""}
						type="number"
						min={1}
						value={initiative.appetiteDays === undefined ? "" : String(initiative.appetiteDays)}
						label={t("board.roadmap.appetiteDays")}
						testId="board-initiative-appetite-days"
						onSave={(value) => {
							const days = value === null ? null : Number(value);
							if (days === null || (Number.isFinite(days) && days > 0))
								onPatch({ appetiteDays: days });
						}}
					/>
				</label>
				<label htmlFor={`${id}-parent`} className="flex min-w-0 flex-col gap-2">
					<span className="tr-text-metadata text-text-muted">{t("board.roadmap.parent")}</span>
					<select
						id={`${id}-parent`}
						data-testid="board-initiative-parent"
						value={initiative.parentId ?? ""}
						onChange={(event) => onPatch({ parentId: event.currentTarget.value || null })}
						className={FIELD}
					>
						<option value="">{t("board.roadmap.noParent")}</option>
						{parentOptions(view, initiative.id).map((candidate) => (
							<option key={candidate.id} value={candidate.id}>
								{t("board.card.blockOption", { id: candidate.id, title: candidate.title })}
							</option>
						))}
					</select>
				</label>
			</div>
			<Section title={t("board.roadmap.outcome")}>
				<SavedTextarea
					key={initiative.outcome}
					value={initiative.outcome}
					label={t("board.roadmap.outcome")}
					testId="board-initiative-outcome"
					placeholder={t("board.roadmap.outcomePlaceholder")}
					onSave={(outcome) => onPatch({ outcome })}
				/>
			</Section>
			<Section title={t("board.roadmap.criteria")}>
				<ItemList
					items={initiative.criteria}
					label={t("board.roadmap.criteria")}
					addLabel={t("board.roadmap.addCriterion")}
					testId="board-initiative-criteria"
					onChange={(criteria) => onPatch({ criteria })}
				/>
			</Section>
			<Section title={t("board.card.specs")}>
				<ItemList
					items={initiative.specRefs}
					label={t("board.card.specs")}
					addLabel={t("board.card.addSpec")}
					testId="board-initiative-specs"
					onChange={(specRefs) => onPatch({ specRefs })}
				/>
			</Section>
		</>
	);
}

export function InitiativeDetails({
	host,
	view,
	board,
	initiative,
	write,
	onError,
	onDeleted,
}: {
	host: PanelHost;
	view: RoadmapView;
	board: BoardView | null;
	initiative: Initiative;
	write: Write;
	onError: (message: string) => void;
	onDeleted: () => void;
}) {
	const t = useT();
	const { projectId } = view;
	const patch = (next: InitiativePatch) =>
		write(() => updateInitiative(host, projectId, initiative.id, next));
	const rollup = view.rollups.initiatives[initiative.id];
	const projects = view.projects.filter((project) => project.initiativeId === initiative.id);
	return (
		<div className="flex flex-col gap-16 p-12">
			<div className="flex flex-col gap-4">
				<span className="flex flex-wrap items-center gap-8">
					<span className="tr-code-text-small text-text-muted">{initiative.id}</span>
					<HorizonChip horizon={initiative.horizon} />
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
				<SavedInput
					key={initiative.title}
					value={initiative.title}
					label={t("board.roadmap.titleLabel")}
					testId="board-initiative-title"
					onSave={(title) => patch({ title })}
				/>
				{initiative.proposed ? (
					<span className="flex flex-wrap items-center gap-4">
						<span className="tr-text-metadata text-text-muted">
							{t("board.roadmap.proposedHint")}
						</span>
						<Button
							variant="soft-primary"
							size="s"
							iconLeft={RiCheckLine}
							data-testid="board-initiative-accept"
							onClick={() => write(() => acceptInitiative(host, projectId, initiative.id))}
						>
							{t("board.roadmap.accept")}
						</Button>
						<Button
							variant="ghost"
							size="s"
							iconLeft={RiDeleteBinLine}
							data-testid="board-initiative-discard"
							onClick={() =>
								write(async () => {
									await deleteInitiative(host, projectId, initiative.id);
									onDeleted();
								})
							}
						>
							{t("board.roadmap.discard")}
						</Button>
					</span>
				) : null}
			</div>
			<InitiativeFacts view={view} initiative={initiative} onPatch={patch} />
			<Section title={t("board.roadmap.progress.title")} testId="board-initiative-progress">
				<StackBar rollup={rollup} />
				<ProgressLegend rollup={rollup} />
			</Section>
			<Section title={t("board.roadmap.health.title")}>
				<HealthBlock view={view} initiative={initiative} onPatch={patch} />
			</Section>
			<Section title={t("board.roadmap.agentsTitle")}>
				<AgentsNow host={host} board={board} initiative={initiative} />
			</Section>
			<Section title={t("board.roadmap.forecastTitle")}>
				<ForecastBlock view={view} initiative={initiative} />
			</Section>
			<Section title={t("board.roadmap.projects")} testId="board-initiative-projects">
				{projects.length > 0 ? (
					<ul className="flex flex-col gap-8">
						{projects.map((project) => (
							<ProjectBlock
								key={project.id}
								host={host}
								view={view}
								board={board}
								project={project}
								write={write}
							/>
						))}
					</ul>
				) : null}
				<AddField
					label={t("board.roadmap.projectAdd")}
					testId="board-initiative-project-add"
					onAdd={(title) =>
						write(() => createRoadmapProject(host, projectId, initiative.id, title))
					}
				/>
			</Section>
			<Section title={t("board.roadmap.cards")}>
				<MemberCards host={host} view={view} board={board} initiative={initiative} write={write} />
			</Section>
			<Section title={t("board.roadmap.agentTitle")}>
				<AgentActions host={host} view={view} initiative={initiative} onError={onError} />
				<DraftUpdateBlock host={host} view={view} initiative={initiative} write={write} />
			</Section>
			<ConfirmDelete
				wide
				label={t("board.roadmap.delete")}
				question={t("board.roadmap.deleteConfirm")}
				testId="board-initiative-delete"
				onDelete={() =>
					write(async () => {
						await deleteInitiative(host, projectId, initiative.id);
						onDeleted();
					})
				}
			/>
		</div>
	);
}

function Notice({ children }: { children: ReactNode }) {
	return (
		<p
			role="alert"
			data-testid="board-initiative-notice"
			className="px-12 pt-8 tr-text-metadata text-feedback-error wrap-anywhere"
		>
			{children}
		</p>
	);
}

/** An initiative in Peek: its text, progress, health, forecast, projects, cards and agent actions. */
export default function InitiativePanel({ host, params }: PanelProps) {
	const t = useT();
	const projectId = params.projectId ?? host.scope.projectId;
	const initiativeId = params.initiativeId ?? "";
	const [error, setError] = useState<string | null>(null);
	const [deleted, setDeleted] = useState(false);
	const roadmap = useHostQuery(`roadmap:${projectId}`, (signal) =>
		loadRoadmap(host, projectId, signal),
	);
	const board = useHostQuery(`board:${projectId}`, (signal) => loadBoard(host, projectId, signal));
	useBoardChanged(host, projectId, () => {
		roadmap.reload();
		board.reload();
	});
	const write: Write = (run) =>
		void run().then(
			() => {
				setError(null);
				roadmap.reload();
				board.reload();
			},
			(failure: unknown) => {
				setError(errorText(t, failure));
				roadmap.reload();
			},
		);
	const view = roadmap.state.kind === "ready" ? roadmap.state.value : null;
	const initiative = view?.initiatives.find((candidate) => candidate.id === initiativeId);
	return (
		<div
			data-testid="board-initiative-panel"
			data-initiative-id={initiativeId}
			className="h-full min-h-0 overflow-auto"
		>
			{error ? <Notice>{error}</Notice> : null}
			{deleted ? (
				<div data-testid="board-initiative-deleted" className="p-16 tr-text-ui text-text-muted">
					{t("board.roadmap.deleted", { id: initiativeId })}
				</div>
			) : roadmap.state.kind === "loading" ? (
				<LoadingRegion rows={10} label={t("board.loading")} className="p-16" />
			) : roadmap.state.kind === "error" ? (
				<div className="flex flex-col items-start gap-8 p-16">
					<span className="tr-text-ui text-text-muted">{t("board.roadmap.loadError")}</span>
					<span className="tr-text-metadata text-text-subtle wrap-anywhere">
						{roadmap.state.message}
					</span>
					<Button variant="outline" size="m" onClick={roadmap.reload}>
						{t("board.retry")}
					</Button>
				</div>
			) : view && initiative ? (
				<InitiativeDetails
					key={initiative.id}
					host={host}
					view={view}
					board={board.state.kind === "ready" ? board.state.value : null}
					initiative={initiative}
					write={write}
					onError={setError}
					onDeleted={() => setDeleted(true)}
				/>
			) : (
				<div data-testid="board-initiative-missing" className="p-16 tr-text-ui text-text-muted">
					{t("board.roadmap.missing", { id: initiativeId })}
				</div>
			)}
		</div>
	);
}
