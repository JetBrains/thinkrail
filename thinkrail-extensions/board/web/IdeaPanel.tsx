import {
	RiAddLine,
	RiArrowGoBackLine,
	RiCheckLine,
	RiCloseCircleLine,
	RiCloseLine,
	RiFileTextLine,
	RiFlag2Line,
	RiRocket2Line,
	RiScales3Line,
	RiSearchLine,
} from "@remixicon/react";
import type { PanelHost, PanelProps } from "@thinkrail/extension-api/web";
import { type Translator, useT } from "@thinkrail/locales/react";
import { Button, IconButton } from "@thinkrail/ui/button";
import { LoadingRegion } from "@thinkrail/ui/skeleton";
import { cn } from "@thinkrail/ui/utils";
import { type ReactNode, useId, useState } from "react";
import { FIELD } from "./CardParts";
import { IdeaStatusChip } from "./Discovery";
import {
	addEvidence,
	confirmScore,
	deleteIdea,
	EVIDENCE_KINDS,
	type Evidence,
	type EvidenceKind,
	type Idea,
	loadDiscovery,
	openDiscoveryChat,
	openReport,
	promoteIdea,
	removeEvidence,
	SCORE_KEYS,
	SCORES,
	type ScoreKey,
	safeHref,
	setScore,
	updateIdea,
} from "./discoveryApi";
import { ConfirmDelete, ItemList, SavedInput, SavedTextarea, Section } from "./Fields";
import { DISCOVERY_CHAT_LABELS, EVIDENCE_KIND_LABELS, SCORE_LABELS } from "./labels";
import { HorizonChip } from "./RoadmapParts";
import { initiativePeekEntry, type StartedChat } from "./roadmapApi";
import { useBoardChanged, useHostQuery } from "./useHostQuery";

/** Runs a write, then re-reads; answers whether it went through (a failure shows as the notice). */
type Write = (run: () => Promise<unknown>) => Promise<boolean>;

function errorText(t: Translator, error: unknown): string {
	return error instanceof Error && error.message ? error.message : t("board.error.unknown");
}

/** A value or effort: its score (a human's pick or the agent's suggestion to confirm) and reasons. */
function ScoreBlock({
	which,
	idea,
	projectId,
	host,
	write,
}: {
	which: ScoreKey;
	idea: Idea;
	projectId: string;
	host: PanelHost;
	write: Write;
}) {
	const t = useT();
	const id = useId();
	const score = idea[which];
	return (
		<div
			data-testid={`board-idea-${which}`}
			data-suggested={score?.suggested || undefined}
			className="flex min-w-0 flex-col gap-4"
		>
			<span className="flex flex-wrap items-center gap-8">
				<label htmlFor={id} className="tr-text-emphasis text-text-default">
					{t(SCORE_LABELS[which])}
				</label>
				<select
					id={id}
					data-testid={`board-idea-${which}-score`}
					value={score ? String(score.score) : ""}
					onChange={(event) => {
						const raw = event.currentTarget.value;
						void write(() => setScore(host, projectId, idea.id, which, raw ? Number(raw) : null));
					}}
					className={cn(FIELD, "w-auto")}
				>
					<option value="">{t("board.discovery.score.none")}</option>
					{SCORES.map((value) => (
						<option key={value} value={String(value)}>
							{t("board.discovery.score.option", { score: value })}
						</option>
					))}
				</select>
				{score?.suggested ? (
					<>
						<span
							data-testid={`board-idea-${which}-suggested`}
							className="rounded-full bg-primary-subtle px-8 tr-text-label-pill text-primary"
						>
							{t("board.discovery.score.suggested")}
						</span>
						<Button
							variant="soft-primary"
							size="s"
							iconLeft={RiCheckLine}
							data-testid={`board-idea-${which}-confirm`}
							onClick={() => write(() => confirmScore(host, projectId, idea, which))}
						>
							{t("board.discovery.score.confirm")}
						</Button>
					</>
				) : null}
			</span>
			{score ? (
				<ItemList
					items={score.reasons}
					label={t("board.discovery.score.reasons")}
					addLabel={t("board.discovery.score.addReason")}
					testId={`board-idea-${which}-reasons`}
					onChange={(reasons) =>
						write(() =>
							updateIdea(host, projectId, idea.id, { [which]: { score: score.score, reasons } }),
						)
					}
				/>
			) : null}
		</div>
	);
}

function EvidenceRow({
	evidence,
	host,
	projectId,
	onRemove,
}: {
	evidence: Evidence;
	host: PanelHost;
	projectId: string;
	onRemove: () => void;
}) {
	const t = useT();
	const href = evidence.kind === "url" ? safeHref(evidence.ref) : null;
	let target: ReactNode;
	if (href)
		target = (
			<a
				href={href}
				target="_blank"
				rel="noreferrer"
				data-testid="board-idea-evidence-link"
				className="min-w-0 rounded-xs tr-code-text-small text-text-default underline wrap-anywhere focus-visible:focus-ring"
			>
				{evidence.ref}
			</a>
		);
	else if (evidence.kind === "artifact")
		target = (
			<button
				type="button"
				data-testid="board-idea-evidence-open"
				title={t("board.discovery.evidence.open")}
				onClick={() =>
					openReport(host, projectId, {
						path: evidence.ref,
						...(evidence.workspaceId ? { workspaceId: evidence.workspaceId } : {}),
					})
				}
				className="flex min-w-0 items-center gap-4 rounded-xs text-left tr-code-text-small text-text-default underline wrap-anywhere focus-visible:focus-ring"
			>
				<RiFileTextLine aria-hidden className="size-12 shrink-0" />
				{evidence.ref}
			</button>
		);
	else
		target = (
			<span className="min-w-0 tr-text-ui text-text-default wrap-anywhere">{evidence.ref}</span>
		);
	return (
		<li
			data-testid="board-idea-evidence"
			data-evidence-id={evidence.id}
			data-kind={evidence.kind}
			className="flex min-w-0 flex-col gap-2 rounded-xs border border-border-muted p-8"
		>
			<span className="flex min-w-0 items-start gap-8">
				<span className="shrink-0 tr-code-text-small text-text-subtle">{evidence.id}</span>
				<span className="shrink-0 rounded-xs bg-control-bg-selected px-4 tr-text-metadata text-text-muted">
					{t(EVIDENCE_KIND_LABELS[evidence.kind])}
				</span>
				<span className="min-w-0 flex-1">{target}</span>
				<IconButton
					icon={RiCloseLine}
					size="s"
					label={t("board.discovery.evidence.remove", { id: evidence.id })}
					data-testid="board-idea-evidence-remove"
					onClick={onRemove}
				/>
			</span>
			{evidence.quote ? (
				<blockquote className="border-border-default border-l-2 pl-8 tr-text-ui text-text-muted wrap-anywhere">
					{evidence.quote}
				</blockquote>
			) : null}
			<span className="tr-text-metadata text-text-subtle">
				{evidence.addedBy === "agent"
					? t("board.discovery.evidence.byAgent")
					: t("board.discovery.evidence.byYou")}
			</span>
		</li>
	);
}

function EvidenceForm({
	onAdd,
}: {
	/** Answers whether it was added, which clears the form. */
	onAdd: (input: { kind: EvidenceKind; ref: string; quote?: string }) => Promise<boolean>;
}) {
	const t = useT();
	const id = useId();
	const [kind, setKind] = useState<EvidenceKind>("url");
	const [ref, setRef] = useState("");
	const [quote, setQuote] = useState("");
	const [busy, setBusy] = useState(false);
	const submit = () => {
		const trimmed = ref.trim();
		if (!trimmed || busy) return;
		setBusy(true);
		void onAdd({ kind, ref: trimmed, ...(quote.trim() ? { quote: quote.trim() } : {}) }).then(
			(added) => {
				setBusy(false);
				if (!added) return;
				setRef("");
				setQuote("");
			},
		);
	};
	return (
		<form
			data-testid="board-idea-evidence-form"
			className="flex min-w-0 flex-col gap-4"
			onSubmit={(event) => {
				event.preventDefault();
				submit();
			}}
		>
			<span className="flex min-w-0 items-center gap-4">
				<label htmlFor={`${id}-kind`} className="sr-only">
					{t("board.discovery.evidence.kindLabel")}
				</label>
				<select
					id={`${id}-kind`}
					data-testid="board-idea-evidence-kind"
					value={kind}
					onChange={(event) => {
						const picked = EVIDENCE_KINDS.find((value) => value === event.currentTarget.value);
						if (picked) setKind(picked);
					}}
					className={cn(FIELD, "w-auto shrink-0")}
				>
					{EVIDENCE_KINDS.map((value) => (
						<option key={value} value={value}>
							{t(EVIDENCE_KIND_LABELS[value])}
						</option>
					))}
				</select>
				<input
					data-testid="board-idea-evidence-ref"
					aria-label={t("board.discovery.evidence.refLabel")}
					placeholder={
						kind === "url"
							? t("board.discovery.evidence.urlPlaceholder")
							: kind === "artifact"
								? t("board.discovery.evidence.artifactPlaceholder")
								: t("board.discovery.evidence.notePlaceholder")
					}
					value={ref}
					onChange={(event) => setRef(event.currentTarget.value)}
					className={FIELD}
				/>
			</span>
			<span className="flex min-w-0 items-center gap-4">
				<input
					data-testid="board-idea-evidence-quote"
					aria-label={t("board.discovery.evidence.quoteLabel")}
					placeholder={t("board.discovery.evidence.quotePlaceholder")}
					value={quote}
					onChange={(event) => setQuote(event.currentTarget.value)}
					className={FIELD}
				/>
				<Button
					type="submit"
					size="s"
					iconLeft={RiAddLine}
					loading={busy}
					disabled={!ref.trim()}
					data-testid="board-idea-evidence-add"
				>
					{t("board.discovery.evidence.add")}
				</Button>
			</span>
		</form>
	);
}

type IdeaAction = "research" | "analyze" | "promote";

const ACTION_ICONS = {
	research: RiSearchLine,
	analyze: RiScales3Line,
	promote: RiRocket2Line,
} as const;

function AgentActions({
	host,
	projectId,
	idea,
	onError,
}: {
	host: PanelHost;
	projectId: string;
	idea: Idea;
	onError: (message: string) => void;
}) {
	const t = useT();
	const [starting, setStarting] = useState<IdeaAction | null>(null);
	const open = idea.status === "new" || idea.status === "analyzed";
	const start = (action: IdeaAction) => {
		setStarting(action);
		const run: Promise<StartedChat> =
			action === "promote"
				? promoteIdea(host, projectId, idea.id)
				: openDiscoveryChat(host, projectId, action, { ideaId: idea.id });
		run
			.then(
				(started) => {
					if (started.kickoffError)
						onError(t("board.roadmap.chat.notSent", { error: started.kickoffError }));
				},
				(error: unknown) => onError(errorText(t, error)),
			)
			.finally(() => setStarting(null));
	};
	const actions: readonly IdeaAction[] = open ? ["research", "analyze", "promote"] : ["research"];
	return (
		<div className="flex flex-col gap-4">
			<span className="flex flex-wrap gap-4">
				{actions.map((action) => (
					<Button
						key={action}
						variant={action === "promote" ? "soft-primary" : "outline"}
						size="s"
						iconLeft={ACTION_ICONS[action]}
						loading={starting === action}
						disabled={starting !== null && starting !== action}
						data-testid={`board-idea-chat-${action}`}
						onClick={() => start(action)}
					>
						{action === "promote"
							? t("board.discovery.chat.promote")
							: t(DISCOVERY_CHAT_LABELS[action])}
					</Button>
				))}
			</span>
			<span className="tr-text-metadata text-text-subtle">{t("board.discovery.chat.hint")}</span>
		</div>
	);
}

export function IdeaDetails({
	host,
	projectId,
	idea,
	write,
	onError,
	onDeleted,
}: {
	host: PanelHost;
	projectId: string;
	idea: Idea;
	write: Write;
	onError: (message: string) => void;
	onDeleted: () => void;
}) {
	const t = useT();
	const patch = (next: Parameters<typeof updateIdea>[3]) =>
		write(() => updateIdea(host, projectId, idea.id, next));
	const suggestion = idea.horizonSuggestion;
	return (
		<div className="flex flex-col gap-16 p-12">
			<div className="flex flex-col gap-4">
				<span className="flex flex-wrap items-center gap-8">
					<span className="tr-code-text-small text-text-muted">{idea.id}</span>
					<IdeaStatusChip status={idea.status} />
					{idea.initiativeId ? (
						idea.initiative ? (
							<Button
								variant="ghost"
								size="s"
								iconLeft={RiFlag2Line}
								data-testid="board-idea-initiative"
								onClick={() => {
									if (idea.initiative) host.peek(initiativePeekEntry(projectId, idea.initiative));
								}}
							>
								{t("board.discovery.promotedTo", {
									id: idea.initiative.id,
									title: idea.initiative.title,
								})}
							</Button>
						) : (
							<span className="tr-text-metadata text-text-subtle">
								{t("board.discovery.promotedGone", { id: idea.initiativeId })}
							</span>
						)
					) : null}
				</span>
				<SavedInput
					key={idea.title}
					value={idea.title}
					label={t("board.discovery.titleLabel")}
					testId="board-idea-title"
					onSave={(title) => patch({ title })}
				/>
			</div>
			<Section title={t("board.discovery.pitch")}>
				<SavedTextarea
					key={idea.pitch}
					value={idea.pitch}
					label={t("board.discovery.pitch")}
					testId="board-idea-pitch"
					placeholder={t("board.discovery.pitchPlaceholder")}
					onSave={(pitch) => patch({ pitch })}
				/>
			</Section>
			<Section title={t("board.discovery.scoresTitle")} testId="board-idea-scores">
				{SCORE_KEYS.map((key) => (
					<ScoreBlock
						key={key}
						which={key}
						idea={idea}
						projectId={projectId}
						host={host}
						write={write}
					/>
				))}
				<span className="tr-text-metadata text-text-subtle">{t("board.discovery.score.hint")}</span>
			</Section>
			<Section title={t("board.discovery.horizonTitle")} testId="board-idea-horizon">
				{suggestion ? (
					<span className="flex flex-wrap items-center gap-8">
						<HorizonChip horizon={suggestion.horizon} />
						<span className="tr-text-ui text-text-default wrap-anywhere">{suggestion.reason}</span>
					</span>
				) : (
					<span className="tr-text-metadata text-text-subtle">
						{t("board.discovery.horizonNone")}
					</span>
				)}
			</Section>
			<Section title={t("board.discovery.evidence.title")} testId="board-idea-evidence-section">
				{idea.evidence.length > 0 ? (
					<ul className="flex flex-col gap-4">
						{idea.evidence.map((evidence) => (
							<EvidenceRow
								key={evidence.id}
								evidence={evidence}
								host={host}
								projectId={projectId}
								onRemove={() => write(() => removeEvidence(host, projectId, idea.id, evidence.id))}
							/>
						))}
					</ul>
				) : (
					<span className="tr-text-metadata text-text-subtle">
						{t("board.discovery.evidence.empty")}
					</span>
				)}
				<EvidenceForm
					onAdd={(input) => write(() => addEvidence(host, projectId, idea.id, input))}
				/>
			</Section>
			<Section title={t("board.discovery.agentTitle")}>
				<AgentActions host={host} projectId={projectId} idea={idea} onError={onError} />
			</Section>
			<span className="flex flex-wrap items-center gap-8">
				{idea.status === "dismissed" ? (
					<Button
						variant="outline"
						size="s"
						iconLeft={RiArrowGoBackLine}
						data-testid="board-idea-restore"
						onClick={() => patch({ dismissed: false })}
					>
						{t("board.discovery.restore")}
					</Button>
				) : idea.status !== "promoted" ? (
					<Button
						variant="ghost"
						size="s"
						iconLeft={RiCloseCircleLine}
						data-testid="board-idea-dismiss"
						onClick={() => patch({ dismissed: true })}
					>
						{t("board.discovery.dismiss")}
					</Button>
				) : null}
				<ConfirmDelete
					wide
					label={t("board.discovery.delete")}
					question={t("board.discovery.deleteConfirm")}
					testId="board-idea-delete"
					onDelete={() =>
						write(async () => {
							await deleteIdea(host, projectId, idea.id);
							onDeleted();
						})
					}
				/>
			</span>
		</div>
	);
}

function Notice({ children }: { children: ReactNode }) {
	return (
		<p
			role="alert"
			data-testid="board-idea-notice"
			className="px-12 pt-8 tr-text-metadata text-feedback-error wrap-anywhere"
		>
			{children}
		</p>
	);
}

/** An idea in Peek: its pitch, scores with reasons, horizon, evidence and the agent actions. */
export default function IdeaPanel({ host, params }: PanelProps) {
	const t = useT();
	const projectId = params.projectId ?? host.scope.projectId;
	const ideaId = params.ideaId ?? "";
	const [error, setError] = useState<string | null>(null);
	const [deleted, setDeleted] = useState(false);
	const discovery = useHostQuery(`discovery:${projectId}`, (signal) =>
		loadDiscovery(host, projectId, signal),
	);
	useBoardChanged(host, projectId, discovery.reload);
	const write: Write = (run) =>
		run().then(
			() => {
				setError(null);
				discovery.reload();
				return true;
			},
			(failure: unknown) => {
				setError(errorText(t, failure));
				discovery.reload();
				return false;
			},
		);
	const view = discovery.state.kind === "ready" ? discovery.state.value : null;
	const idea = view?.ideas.find((candidate) => candidate.id === ideaId);
	return (
		<div
			data-testid="board-idea-panel"
			data-idea-id={ideaId}
			className="h-full min-h-0 overflow-auto"
		>
			{error ? <Notice>{error}</Notice> : null}
			{deleted ? (
				<div data-testid="board-idea-deleted" className="p-16 tr-text-ui text-text-muted">
					{t("board.discovery.deleted", { id: ideaId })}
				</div>
			) : discovery.state.kind === "loading" ? (
				<LoadingRegion rows={8} label={t("board.loading")} className="p-16" />
			) : discovery.state.kind === "error" ? (
				<div className="flex flex-col items-start gap-8 p-16">
					<span className="tr-text-ui text-text-muted">{t("board.discovery.loadError")}</span>
					<span className="tr-text-metadata text-text-subtle wrap-anywhere">
						{discovery.state.message}
					</span>
					<Button variant="outline" size="m" onClick={discovery.reload}>
						{t("board.retry")}
					</Button>
				</div>
			) : idea ? (
				<IdeaDetails
					key={idea.id}
					host={host}
					projectId={projectId}
					idea={idea}
					write={write}
					onError={setError}
					onDeleted={() => setDeleted(true)}
				/>
			) : (
				<div data-testid="board-idea-missing" className="p-16 tr-text-ui text-text-muted">
					{t("board.discovery.missing", { id: ideaId })}
				</div>
			)}
		</div>
	);
}
