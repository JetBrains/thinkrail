import {
	RiAddLine,
	RiChat3Line,
	RiCloseLine,
	RiDeleteBinLine,
	RiExternalLinkLine,
	RiFileList3Line,
	RiGithubLine,
	RiInboxArchiveLine,
	RiInboxUnarchiveLine,
} from "@remixicon/react";
import type { PanelHost, PanelProps } from "@thinkrail/extension-api/web";
import { type Translator, useT } from "@thinkrail/locales/react";
import { Button, IconButton } from "@thinkrail/ui/button";
import { isImeComposing } from "@thinkrail/ui/keyboard";
import { LoadingRegion } from "@thinkrail/ui/skeleton";
import { Textarea } from "@thinkrail/ui/textarea";
import { type ReactNode, useId, useState } from "react";
import {
	adoptCard,
	agentBadge,
	type BoardView,
	CARD_SIZES,
	CARD_TYPES,
	type Card,
	type CardDetail,
	type CardPatch,
	canAdopt,
	deleteCard,
	loadBoard,
	loadCard,
	openTaskSpec,
	sendDeferrals,
	type TaskSpecRef,
	type Transition,
	updateCard,
} from "./api";
import {
	AgentBadgeChip,
	CardMeta,
	FIELD,
	LastActionLine,
	LiveLine,
	PlanProgress,
	PrChip,
	TaskSpecStatus,
} from "./CardParts";
import { ACTOR_LABELS, columnTitle, TYPE_LABELS, WORKFLOW_LABELS } from "./labels";
import { StartSection } from "./StartSection";
import { useBoardChanged, useHostQuery } from "./useHostQuery";

function Section({ title, children }: { title: string; children: ReactNode }) {
	return (
		<section className="flex flex-col gap-4">
			<h3 className="tr-text-eyebrow text-text-muted">{title}</h3>
			{children}
		</section>
	);
}

/** A text field that writes on blur or Enter, when its value changed; keyed by the saved value. */
function SavedInput({
	value,
	label,
	testId,
	onSave,
}: {
	value: string;
	label: string;
	testId: string;
	onSave: (value: string) => void;
}) {
	const [draft, setDraft] = useState(value);
	const save = () => {
		const trimmed = draft.trim();
		if (trimmed && trimmed !== value) onSave(trimmed);
		else setDraft(value);
	};
	return (
		<input
			data-testid={testId}
			aria-label={label}
			value={draft}
			onChange={(event) => setDraft(event.currentTarget.value)}
			onBlur={save}
			onKeyDown={(event) => {
				if (event.key !== "Enter" || isImeComposing(event.nativeEvent)) return;
				event.preventDefault();
				save();
			}}
			className={`${FIELD} tr-title-compact`}
		/>
	);
}

function SavedTextarea({
	value,
	label,
	onSave,
}: {
	value: string;
	label: string;
	onSave: (value: string) => void;
}) {
	const [draft, setDraft] = useState(value);
	return (
		<Textarea
			data-testid="board-card-description"
			aria-label={label}
			rows={4}
			value={draft}
			onChange={(event) => setDraft(event.currentTarget.value)}
			onBlur={() => {
				if (draft !== value) onSave(draft);
			}}
		/>
	);
}

/** An editable list of short strings: acceptance criteria, spec refs. */
function ItemList({
	items,
	label,
	addLabel,
	testId,
	onChange,
}: {
	items: readonly string[];
	label: string;
	addLabel: string;
	testId: string;
	onChange: (items: string[]) => void;
}) {
	const t = useT();
	const [draft, setDraft] = useState("");
	const add = () => {
		const trimmed = draft.trim();
		if (!trimmed) return;
		onChange([...items, trimmed]);
		setDraft("");
	};
	return (
		<div data-testid={testId} className="flex flex-col gap-4">
			<ul className="flex flex-col gap-2">
				{items.map((item, index) => (
					<li
						key={`${index}:${item}`}
						data-testid={`${testId}-item`}
						className="flex items-start gap-4 tr-text-ui text-text-default"
					>
						<span className="min-w-0 flex-1 wrap-anywhere">{item}</span>
						<IconButton
							icon={RiCloseLine}
							size="s"
							label={t("board.card.removeItem", { item })}
							onClick={() => onChange(items.filter((_, position) => position !== index))}
						/>
					</li>
				))}
			</ul>
			<form
				className="flex items-center gap-4"
				onSubmit={(event) => {
					event.preventDefault();
					add();
				}}
			>
				<input
					data-testid={`${testId}-add`}
					aria-label={label}
					placeholder={addLabel}
					value={draft}
					onChange={(event) => setDraft(event.currentTarget.value)}
					className={FIELD}
				/>
				<IconButton
					icon={RiAddLine}
					size="s"
					type="submit"
					label={addLabel}
					disabled={!draft.trim()}
				/>
			</form>
		</div>
	);
}

function placementText(t: Translator, placement: Transition["from"]): string {
	return placement ? columnTitle(t, placement.column) : t("board.activity.none");
}

function Activity({ transitions }: { transitions: readonly Transition[] }) {
	const t = useT();
	if (transitions.length === 0)
		return <span className="tr-text-metadata text-text-subtle">{t("board.activity.empty")}</span>;
	return (
		<ol data-testid="board-activity" className="flex flex-col gap-2">
			{[...transitions].reverse().map((transition) => (
				<li
					key={`${transition.at}:${transition.reason}`}
					data-testid="board-activity-item"
					data-actor={transition.actor}
					className="flex flex-wrap items-baseline gap-4 tr-text-metadata text-text-muted"
				>
					<time
						className="tabular-nums text-text-subtle"
						dateTime={new Date(transition.at).toISOString()}
					>
						{new Date(transition.at).toLocaleString()}
					</time>
					<span className="text-text-default">
						{transition.from === null
							? t("board.activity.created", { to: placementText(t, transition.to) })
							: t("board.activity.move", {
									from: placementText(t, transition.from),
									to: placementText(t, transition.to),
								})}
					</span>
					<span>{t(ACTOR_LABELS[transition.actor])}</span>
					{transition.from === null ? null : (
						<span className="text-text-subtle">{transition.reason}</span>
					)}
				</li>
			))}
		</ol>
	);
}

function Attempts({ host, projectId, card }: { host: PanelHost; projectId: string; card: Card }) {
	const t = useT();
	if (card.attempts.length === 0)
		return <span className="tr-text-metadata text-text-subtle">{t("board.attempts.empty")}</span>;
	return (
		<ul data-testid="board-attempts" className="flex flex-col gap-8">
			{card.attempts.map((attempt, index) => {
				const live = card.live[index];
				const badge = index === card.attempts.length - 1 ? agentBadge(card) : null;
				return (
					<li
						key={attempt.workspaceId}
						data-testid="board-attempt"
						data-open={live?.open || undefined}
						className="flex flex-col gap-4 rounded-sm border border-border-muted p-8"
					>
						<span className="flex flex-wrap items-center gap-8 tr-text-metadata text-text-muted">
							<span className="text-text-default">{t(WORKFLOW_LABELS[attempt.workflow])}</span>
							<time dateTime={new Date(attempt.startedAt).toISOString()}>
								{new Date(attempt.startedAt).toLocaleString()}
							</time>
							<AgentBadgeChip badge={badge} />
							{live?.open ? null : (
								<span className="text-text-subtle">
									{attempt.merged ? t("board.attempts.merged") : t("board.attempts.closed")}
								</span>
							)}
						</span>
						{live?.chat ? (
							<span className="truncate tr-text-ui text-text-default">{live.chat.title}</span>
						) : null}
						<LastActionLine action={live?.chat?.lastAction} />
						<span className="flex flex-wrap items-center gap-8">
							<PlanProgress plan={live?.plan ?? null} />
							<PrChip pr={live?.pr ?? null} />
						</span>
						{attempt.notes.map((note) => (
							<span key={note.at} className="tr-text-metadata text-text-muted wrap-anywhere">
								{note.text}
							</span>
						))}
						{live?.open ? (
							<span className="flex flex-wrap gap-4">
								<Button
									variant="outline"
									size="s"
									iconLeft={RiExternalLinkLine}
									data-testid="board-attempt-workspace"
									onClick={() =>
										host.openWorkspace({ workspaceId: attempt.workspaceId, projectId })
									}
								>
									{t("board.attempts.openWorkspace")}
								</Button>
								<Button
									variant="outline"
									size="s"
									iconLeft={RiChat3Line}
									data-testid="board-attempt-chat"
									onClick={() =>
										host.openChat({
											projectId,
											workspaceId: attempt.workspaceId,
											sessionId: attempt.sessionId,
										})
									}
								>
									{t("board.attempts.openChat")}
								</Button>
							</span>
						) : null}
					</li>
				);
			})}
		</ul>
	);
}

function BlocksEditor({
	board,
	card,
	onChange,
}: {
	/** The card's board, `null` while it loads. */
	board: BoardView | null;
	card: Card;
	onChange: (blocks: string[]) => void;
}) {
	const t = useT();
	const id = useId();
	const others = (board?.cards ?? []).filter(
		(other) => other.id !== card.id && !card.blocks.includes(other.id),
	);
	return (
		<div className="flex flex-col gap-4">
			<ul className="flex flex-wrap gap-4">
				{card.blocks.map((blocked) => (
					<li
						key={blocked}
						data-testid="board-card-block"
						className="flex items-center gap-2 rounded-full bg-control-bg-selected pl-8 tr-text-metadata text-text-default"
					>
						{blocked}
						<IconButton
							icon={RiCloseLine}
							size="s"
							label={t("board.card.removeItem", { item: blocked })}
							onClick={() => onChange(card.blocks.filter((other) => other !== blocked))}
						/>
					</li>
				))}
			</ul>
			<label htmlFor={id} className="sr-only">
				{t("board.card.addBlock")}
			</label>
			<select
				id={id}
				data-testid="board-card-add-block"
				value=""
				disabled={others.length === 0}
				onChange={(event) => {
					const picked = event.currentTarget.value;
					if (picked) onChange([...card.blocks, picked]);
				}}
				className={FIELD}
			>
				<option value="">{t("board.card.addBlock")}</option>
				{others.map((other) => (
					<option key={other.id} value={other.id}>
						{t("board.card.blockOption", { id: other.id, title: other.title })}
					</option>
				))}
			</select>
		</div>
	);
}

/**
 * The card's task-specs, live from its workspaces: each opens in Peek when it is in this workspace (Peek
 * shows the workspace it belongs to), else in its own workspace; a stored card can send one's Deferrals
 * section into Triage.
 */
export function TaskSpecs({
	host,
	card,
	onSent,
}: {
	host: PanelHost;
	card: Card;
	onSent: () => void;
}) {
	const t = useT();
	const [sending, setSending] = useState<string | null>(null);
	const [outcome, setOutcome] = useState<{ error: boolean; text: string } | null>(null);
	const send = (spec: TaskSpecRef) => {
		setSending(spec.id);
		setOutcome(null);
		sendDeferrals(host, card.id, spec.id)
			.then(
				({ created, skipped }) => {
					setOutcome({
						error: false,
						text:
							created > 0
								? t("board.taskSpec.deferralsSent", { count: created })
								: t("board.taskSpec.deferralsNone", { count: skipped }),
					});
					onSent();
				},
				(error: unknown) =>
					setOutcome({
						error: true,
						text: error instanceof Error ? error.message : t("board.error.unknown"),
					}),
			)
			.finally(() => setSending(null));
	};
	return (
		<div className="flex flex-col gap-4">
			<ul data-testid="board-card-task-specs" className="flex flex-col gap-4">
				{card.taskSpecs.map((spec) => {
					const here = spec.workspaceId === host.scope.workspaceId;
					return (
						<li
							key={`${spec.workspaceId}:${spec.id}`}
							data-testid="board-card-task-spec"
							data-spec-id={spec.id}
							className="flex flex-col gap-4 rounded-sm border border-border-muted p-8"
						>
							<span className="flex min-w-0 items-center gap-4">
								<RiFileList3Line aria-hidden className="size-12 shrink-0 text-text-muted" />
								<span className="min-w-0 flex-1 truncate tr-text-ui text-text-default">
									{spec.title}
								</span>
								<TaskSpecStatus status={spec.status} />
							</span>
							<span className="truncate tr-code-text-small text-text-subtle">{spec.path}</span>
							<span className="flex flex-wrap gap-4">
								<Button
									variant="outline"
									size="s"
									iconLeft={RiExternalLinkLine}
									data-testid="board-task-spec-open"
									data-target={here ? "peek" : "workspace"}
									onClick={() => openTaskSpec(host, spec)}
								>
									{here ? t("board.taskSpec.open") : t("board.taskSpec.openThere")}
								</Button>
								{card.virtual ? null : (
									<Button
										variant="ghost"
										size="s"
										iconLeft={RiInboxUnarchiveLine}
										loading={sending === spec.id}
										data-testid="board-task-spec-deferrals"
										onClick={() => send(spec)}
									>
										{t("board.taskSpec.sendDeferrals")}
									</Button>
								)}
							</span>
						</li>
					);
				})}
			</ul>
			{outcome ? (
				<p
					role={outcome.error ? "alert" : "status"}
					data-testid="board-task-spec-outcome"
					className={
						outcome.error
							? "tr-text-metadata text-feedback-error wrap-anywhere"
							: "tr-text-metadata text-text-muted"
					}
				>
					{outcome.text}
				</p>
			) : null}
		</div>
	);
}

/** A GitHub issue's card: the issue, linked, and that the board never changes it there. */
export function IssueLink({ card }: { card: Card }) {
	const t = useT();
	if (card.source.kind !== "github") return null;
	const { number, url } = card.source;
	return (
		<span className="flex flex-wrap items-center gap-4 tr-text-metadata text-text-muted">
			<RiGithubLine aria-hidden className="size-12" />
			{url ? (
				<a
					href={url}
					target="_blank"
					rel="noreferrer"
					data-testid="board-card-issue"
					className="rounded-xs text-text-default underline focus-visible:focus-ring"
				>
					{t("board.source.issue", { number })}
				</a>
			) : (
				<span data-testid="board-card-issue">{t("board.source.issue", { number })}</span>
			)}
			<span className="text-text-subtle">
				{card.virtual ? t("board.source.issueUnstored") : t("board.source.issueStored", { number })}
			</span>
		</span>
	);
}

/** An unbound workspace's task-spec in Peek: what it is, where its work stands, and Adopt. */
export function TaskSpecCardDetails({
	host,
	detail,
	onAdopted,
}: {
	host: PanelHost;
	detail: CardDetail;
	/** The adopted card is the one `card.get` answers for this id from now on. */
	onAdopted: () => void;
}) {
	const t = useT();
	const { card, projectId } = detail;
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const live = card.live.at(-1);
	return (
		<div className="flex flex-col gap-16 p-12">
			<div className="flex flex-col gap-4">
				<span className="flex flex-wrap items-center gap-8">
					<CardMeta card={card} />
					<span data-testid="board-card-column" className="tr-text-metadata text-text-muted">
						{columnTitle(t, card.column)}
					</span>
				</span>
				<h2 data-testid="board-card-heading" className="tr-title-compact text-text-default">
					{card.title}
				</h2>
				<span className="tr-text-metadata text-text-muted">{t("board.taskSpec.unbound")}</span>
				<LiveLine card={card} />
			</div>
			<Section title={t("board.taskSpec.title")}>
				<TaskSpecs host={host} card={card} onSent={() => {}} />
			</Section>
			<span className="flex flex-wrap gap-4">
				<Button
					variant="primary"
					size="m"
					iconLeft={RiInboxArchiveLine}
					loading={busy}
					data-testid="board-card-panel-adopt"
					onClick={() => {
						setBusy(true);
						setError(null);
						adoptCard(host, card.id)
							.then(onAdopted, (failure: unknown) =>
								setError(failure instanceof Error ? failure.message : t("board.error.unknown")),
							)
							.finally(() => setBusy(false));
					}}
				>
					{t("board.card.adopt")}
				</Button>
				{live?.open ? (
					<Button
						variant="outline"
						size="m"
						iconLeft={RiExternalLinkLine}
						data-testid="board-attempt-workspace"
						onClick={() =>
							host.openWorkspace({
								workspaceId: live.workspaceId,
								projectId,
								...(live.chat ? { sessionId: live.sessionId } : {}),
							})
						}
					>
						{t("board.attempts.openWorkspace")}
					</Button>
				) : null}
			</span>
			<p className="tr-text-metadata text-text-subtle">{t("board.taskSpec.adoptHint")}</p>
			{error ? (
				<p role="alert" className="tr-text-metadata text-feedback-error wrap-anywhere">
					{error}
				</p>
			) : null}
		</div>
	);
}

function DeleteCard({ onDelete }: { onDelete: () => void }) {
	const t = useT();
	const [confirming, setConfirming] = useState(false);
	return confirming ? (
		<span className="flex flex-wrap items-center gap-4">
			<span className="tr-text-metadata text-text-muted">{t("board.card.deleteConfirm")}</span>
			<Button
				variant="destructive"
				size="s"
				data-testid="board-card-delete-confirm"
				onClick={onDelete}
			>
				{t("board.card.delete")}
			</Button>
			<Button variant="ghost" size="s" onClick={() => setConfirming(false)}>
				{t("board.card.keep")}
			</Button>
		</span>
	) : (
		<Button
			variant="ghost"
			size="s"
			tone="danger"
			iconLeft={RiDeleteBinLine}
			data-testid="board-card-delete"
			className="self-start"
			onClick={() => setConfirming(true)}
		>
			{t("board.card.delete")}
		</Button>
	);
}

function CardDetails({
	host,
	detail,
	onPatch,
	onDelete,
	onReload,
}: {
	host: PanelHost;
	detail: CardDetail;
	onPatch: (patch: CardPatch) => void;
	onDelete: () => void;
	onReload: () => void;
}) {
	const t = useT();
	const id = useId();
	const { card, projectId } = detail;
	const board = useHostQuery(`board:${projectId}`, (signal) => loadBoard(host, projectId, signal));
	useBoardChanged(host, projectId, board.reload);
	return (
		<div className="flex flex-col gap-16 p-12">
			<div className="flex flex-col gap-4">
				<span className="flex flex-wrap items-center gap-8">
					<CardMeta card={card} />
					<span data-testid="board-card-column" className="tr-text-metadata text-text-muted">
						{columnTitle(t, card.column)}
					</span>
				</span>
				<SavedInput
					key={card.title}
					value={card.title}
					label={t("board.card.titleLabel")}
					testId="board-card-title"
					onSave={(title) => onPatch({ title })}
				/>
				<IssueLink card={card} />
			</div>
			<div className="flex flex-wrap items-end gap-8">
				<label htmlFor={`${id}-type`} className="flex flex-col gap-2">
					<span className="tr-text-metadata text-text-muted">{t("board.card.type")}</span>
					<select
						id={`${id}-type`}
						data-testid="board-card-type"
						value={card.type}
						onChange={(event) => {
							const type = CARD_TYPES.find((value) => value === event.currentTarget.value);
							if (type) onPatch({ type });
						}}
						className={FIELD}
					>
						{CARD_TYPES.map((type) => (
							<option key={type} value={type}>
								{t(TYPE_LABELS[type])}
							</option>
						))}
					</select>
				</label>
				<label htmlFor={`${id}-size`} className="flex flex-col gap-2">
					<span className="tr-text-metadata text-text-muted">{t("board.card.size")}</span>
					<select
						id={`${id}-size`}
						data-testid="board-card-size"
						value={card.size ?? ""}
						onChange={(event) => {
							const size = CARD_SIZES.find((value) => value === event.currentTarget.value);
							onPatch({ size: size ?? null });
						}}
						className={FIELD}
					>
						<option value="">{t("board.card.sizeNone")}</option>
						{CARD_SIZES.map((size) => (
							<option key={size} value={size}>
								{size}
							</option>
						))}
					</select>
				</label>
				{card.size && card.sizeSuggested ? (
					<Button
						variant="outline"
						size="s"
						data-testid="board-card-confirm-size"
						onClick={() => onPatch({ size: card.size ?? null })}
					>
						{t("board.card.confirmSize")}
					</Button>
				) : null}
			</div>
			<Section title={t("board.card.description")}>
				<SavedTextarea
					key={card.description}
					value={card.description}
					label={t("board.card.description")}
					onSave={(description) => onPatch({ description })}
				/>
			</Section>
			<Section title={t("board.card.acceptance")}>
				<ItemList
					items={card.acceptance}
					label={t("board.card.acceptance")}
					addLabel={t("board.card.addAcceptance")}
					testId="board-card-acceptance"
					onChange={(acceptance) => onPatch({ acceptance })}
				/>
			</Section>
			<Section title={t("board.card.blocks")}>
				<BlocksEditor
					board={board.state.kind === "ready" ? board.state.value : null}
					card={card}
					onChange={(blocks) => onPatch({ blocks })}
				/>
				{card.blockedBy.length > 0 ? (
					<span className="tr-text-metadata text-feedback-warning">
						{t("board.card.blockedBy", { ids: card.blockedBy.join(", ") })}
					</span>
				) : null}
			</Section>
			<Section title={t("board.card.specs")}>
				<ItemList
					items={card.specRefs}
					label={t("board.card.specs")}
					addLabel={t("board.card.addSpec")}
					testId="board-card-specs"
					onChange={(specRefs) => onPatch({ specRefs })}
				/>
			</Section>
			{card.taskSpecs.length > 0 ? (
				<Section title={t("board.taskSpec.title")}>
					<TaskSpecs host={host} card={card} onSent={onReload} />
				</Section>
			) : null}
			<Section title={t("board.attempts.title")}>
				<Attempts host={host} projectId={projectId} card={card} />
			</Section>
			<StartSection
				key={`${card.id}:${card.type}:${card.size ?? ""}`}
				host={host}
				card={card}
				projectId={projectId}
				board={board.state}
				onStarted={onReload}
			/>
			<Section title={t("board.activity.title")}>
				<Activity transitions={detail.transitions} />
			</Section>
			{card.virtual ? null : <DeleteCard onDelete={onDelete} />}
		</div>
	);
}

/** A card in Peek: its details, attempts, the Start form and its activity. */
export default function CardPanel({ host, params }: PanelProps) {
	const t = useT();
	const cardId = params.cardId ?? "";
	const [deleted, setDeleted] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const card = useHostQuery(cardId ? `${cardId}:${params.projectId ?? ""}` : null, (signal) =>
		loadCard(host, cardId, params.projectId ?? null, signal),
	);
	const projectId =
		card.state.kind === "ready" ? card.state.value.projectId : (params.projectId ?? null);
	useBoardChanged(host, projectId, card.reload);
	const currentId = card.state.kind === "ready" ? card.state.value.card.id : cardId;
	const write = (run: () => Promise<unknown>) =>
		run().then(
			() => {
				setError(null);
				card.reload();
			},
			(failure: unknown) => {
				setError(failure instanceof Error ? failure.message : t("board.error.unknown"));
				card.reload();
			},
		);
	if (deleted)
		return (
			<div data-testid="board-card-deleted" className="p-16 tr-text-ui text-text-muted">
				{t("board.card.deleted", { id: currentId })}
			</div>
		);
	return (
		<div
			data-testid="board-card-panel"
			data-card-id={cardId}
			className="h-full min-h-0 overflow-auto"
		>
			{error ? (
				<p role="alert" className="px-12 pt-8 tr-text-metadata text-feedback-error wrap-anywhere">
					{error}
				</p>
			) : null}
			{card.state.kind === "loading" ? (
				<LoadingRegion rows={10} label={t("board.loading")} className="p-16" />
			) : card.state.kind === "error" ? (
				<div className="flex flex-col items-start gap-8 p-16">
					<span className="tr-text-ui text-text-muted">{t("board.error.card")}</span>
					<span className="tr-text-metadata text-text-subtle wrap-anywhere">
						{card.state.message}
					</span>
					<Button variant="outline" size="m" onClick={card.reload}>
						{t("board.retry")}
					</Button>
				</div>
			) : canAdopt(card.state.value.card) ? (
				<TaskSpecCardDetails host={host} detail={card.state.value} onAdopted={card.reload} />
			) : (
				<CardDetails
					host={host}
					detail={card.state.value}
					onPatch={(patch) => void write(() => updateCard(host, currentId, patch, projectId ?? ""))}
					onDelete={() =>
						void deleteCard(host, currentId).then(
							() => setDeleted(true),
							(failure: unknown) =>
								setError(failure instanceof Error ? failure.message : t("board.error.unknown")),
						)
					}
					onReload={card.reload}
				/>
			)}
		</div>
	);
}
