import {
	RiArrowDownSLine as ChevronDown,
	RiArrowRightSLine as ChevronRight,
	RiCircleLine as Circle,
	RiErrorWarningLine as CircleAlert,
	RiCheckboxCircleLine as CircleCheck,
	RiRecordCircleLine as CircleDot,
	RiFileCopyLine as Copy,
	RiDownloadLine as Download,
	RiGitBranchLine as GitBranch,
	RiGitCommitLine as GitCommitHorizontal,
	RiGitPullRequestLine as GitPullRequestArrow,
	RiListCheck3 as ListChecks,
	RiLoader4Line as Loader2,
	RiQuestionnaireLine as MessageCircleQuestion,
	RiChat1Line as MessageSquare,
	RiMore2Line as MoreVertical,
	RiAddLine as Plus,
	RiDeleteBin6Line as Trash2,
} from "@remixicon/react";
import type { ReviewComment, TodoGroupItem, TodoItem } from "@thinkrail/contracts";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { AskStatesContext, deriveAskStates } from "../chat/askState";
import { type ChatActions, ChatActionsContext } from "../chat/ChatActions";
import { Markdown } from "../chat/Markdown";
import { VerificationBadge, VerificationGlyph } from "../chat/planKit";
import { planToMarkdown } from "../chat/planMarkdown";
import {
	adoptedCommits,
	changeSetCounts,
	changeSetStat,
	flatItems,
	groupProgress,
	isPlanReady,
	itemChangeSet,
	itemOpenFindings,
	itemRevisions,
	lastAgentText,
	type PlanGlance,
	pendingAsk,
	planCompletionSummary,
	planSections,
	planStaleSummary,
	planSummary,
	reviewableItems,
	reviewChangesRequested,
	reviewSettled,
	sessionGlance,
} from "../chat/planView";
import { StatusIcon } from "../chat/TodoList";
import { AskUserQuestionCard } from "../chat/tools/AskUserQuestionCard";
import { useChatTodos } from "../chat/useChatTodos";
import { LoadingRegion } from "../components/Skeleton";
import { IconTooltip } from "../components/ui/tooltip";
import {
	selectAgentReviewCommentCount,
	selectChatTitle,
	selectWorkspaceById,
	useAppStore,
} from "../store";
import { errorText, getTransport, supportsPlanReview, wsErrorCode } from "../transport";
import { DiffStatBadge } from "./DiffStatBadge";
import { openChatInTab } from "./openChat";
import { openDiffInTab } from "./openTabs";
import { PlanCommitsMenu } from "./PlanCommitsMenu";
import { PrComposeDialog, type PrComposeState } from "./PrComposeDialog";
import { PrSetupDialog, type PrSetupState } from "./PrSetupDialog";
import { FileRow } from "./planFileRow";
import { openReviewLabel, useOpenBranchReview } from "./useOpenBranchReview";

function ChangeSetBlock({
	item,
	workspaceId,
	onOpenCommit,
}: {
	item: TodoItem;
	workspaceId: string;
	onOpenCommit: (sha: string) => void;
}) {
	const [expanded, setExpanded] = useState(false);
	const set = itemChangeSet(item);
	if (!set) return null;
	const Chevron = expanded ? ChevronDown : ChevronRight;
	const { count, added, removed } = changeSetCounts(set);
	return (
		<div
			className="mt-4"
			data-testid="plan-change-set"
			data-kind={set.kind}
			data-expanded={expanded}
		>
			<div className="flex items-center gap-8 px-4">
				<IconTooltip label={expanded ? "Hide changed files" : "Show changed files"}>
					<button
						type="button"
						data-testid="plan-change-set-toggle"
						aria-expanded={expanded}
						onClick={() => setExpanded((v) => !v)}
						className="flex min-h-32 min-w-0 items-center gap-4 rounded-[var(--radius-sm)] px-4 py-2 text-left hover:bg-control-bg-hovered"
					>
						<Chevron className="size-16 shrink-0 text-text-muted" />
						<span className="shrink-0 tr-text-metadata text-text-subtle">
							{count} {count === 1 ? "file" : "files"}
						</span>
					</button>
				</IconTooltip>
				{set.kind === "commit" ? (
					<>
						<IconTooltip label="Open this step's commit in the Changes panel">
							<button
								type="button"
								data-testid="plan-commit-chip"
								onClick={() => onOpenCommit(set.sha)}
								className="flex min-h-32 shrink-0 items-center gap-4 rounded-[var(--radius-sm)] px-4 py-2 tr-code-text text-text-subtle hover:bg-control-bg-hovered hover:text-text-default"
							>
								<GitCommitHorizontal className="size-14" />
								{set.sha.slice(0, 7)}
							</button>
						</IconTooltip>
						<DiffStatBadge added={added} removed={removed} />
					</>
				) : null}
			</div>
			{expanded ? (
				set.kind === "paths" ? (
					<ul className="flex flex-col">
						{set.paths.map((path) => (
							<FileRow
								key={path}
								file={{ path, status: "modified" }}
								onOpen={() => void openDiffInTab(workspaceId, { kind: "branch" }, path, "preview")}
							/>
						))}
					</ul>
				) : (
					<ul className="flex flex-col">
						{set.files.map((file) => (
							<FileRow
								key={file.path}
								file={file}
								onOpen={() =>
									void openDiffInTab(
										workspaceId,
										{ kind: "commit", sha: set.sha },
										file.path,
										"preview",
									)
								}
							/>
						))}
					</ul>
				)
			) : null}
		</div>
	);
}

// One card shape for every top-of-plan block (next-action banner, Summary, Now executing).
const PLAN_CARD_CLASS =
	"mb-16 rounded-[var(--radius-md)] border border-border-default bg-container-elevated-bg p-12";
const NEXT_ACTION_CLASS = `${PLAN_CARD_CLASS} flex items-center gap-8`;
const NEXT_ACTION_BUTTON_CLASS =
	"flex h-28 shrink-0 items-center rounded-[var(--radius-sm)] bg-control-primary-bg px-8 tr-text-ui text-control-primary-text transition-colors hover:bg-control-primary-bg-hovered disabled:bg-control-primary-disabled-bg disabled:text-control-primary-disabled-text";

type StageState = "done" | "active" | "pending";

function StageGlyph({ state }: { state: StageState }) {
	const Icon = state === "done" ? CircleCheck : state === "active" ? CircleDot : Circle;
	return (
		<Icon
			className={`size-14 shrink-0 ${
				state === "done"
					? "text-feedback-success"
					: state === "active"
						? "text-primary"
						: "text-text-muted"
			}`}
		/>
	);
}

function RevisionsBlock({
	item,
	onOpenCommit,
}: {
	item: TodoItem;
	onOpenCommit: (sha: string) => void;
}) {
	const revisions = itemRevisions(item);
	if (revisions.length < 2) return null;
	const unreviewed = new Set(item.review?.unreviewedShas ?? []);
	return (
		<div data-testid="plan-revisions">
			<span className="px-4 tr-text-eyebrow text-text-subtle">Revisions</span>
			<ol className="flex flex-col">
				{revisions.map((rev, index) => {
					const stat = rev.files ? changeSetStat(rev.files) : null;
					return (
						<li
							key={rev.sha}
							data-testid="plan-revision"
							data-sha={rev.sha}
							data-unreviewed={unreviewed.has(rev.sha)}
							className="flex items-center gap-8 px-4"
						>
							<span className="w-20 shrink-0 text-right tr-text-metadata text-text-muted">
								#{index + 1}
							</span>
							<button
								type="button"
								onClick={() => onOpenCommit(rev.sha)}
								title="Open this revision's commit in the Changes panel"
								className="flex min-h-8 shrink-0 items-center gap-4 rounded-[var(--radius-sm)] px-4 py-2 tr-code-text text-text-subtle hover:bg-control-bg-hovered hover:text-text-default"
							>
								<GitCommitHorizontal className="size-14" />
								{rev.sha.slice(0, 7)}
							</button>
							{stat ? <DiffStatBadge added={stat.added} removed={stat.removed} /> : null}
							{unreviewed.has(rev.sha) ? (
								<span className="tr-text-metadata text-feedback-warning">unreviewed</span>
							) : null}
							{index === revisions.length - 1 ? (
								<span className="tr-text-metadata text-text-subtle">current</span>
							) : null}
						</li>
					);
				})}
			</ol>
		</div>
	);
}

function ItemBlock({
	item,
	workspaceId,
	sessionId,
	onOpenCommit,
	onStartReview,
	onOpenReview,
	onRemove,
	reviewComments,
	startDisabled,
	focusRequest,
}: {
	item: TodoItem;
	workspaceId: string;
	sessionId: string;
	onOpenCommit: (sha: string) => void;
	onStartReview: (id: string) => Promise<void>;
	onOpenReview: () => void;
	onRemove?: ((id: string) => void) | undefined;
	reviewComments: ReviewComment[] | undefined;
	startDisabled: boolean;
	focusRequest: { id: string; tick: number } | null;
}) {
	const reviewed = reviewSettled(item);
	const reviewing = item.review?.reviewing === true;
	const changesRequested = reviewChangesRequested(item) && !reviewing;
	const needsReview = item.review !== undefined && !reviewed;
	// A done step needs no status glyph — its section (or strikethrough) already says "done"; only a
	// warning (changes requested) or an active review keeps a leading glyph.
	const hideStatusGlyph = item.status === "done" && !reviewing && !changesRequested;
	const findings = changesRequested ? itemOpenFindings(item, reviewComments, sessionId) : 0;
	const set = itemChangeSet(item);
	const counts = set ? changeSetCounts(set) : null;
	const fileCount = counts?.count ?? 0;
	const feedback = changesRequested ? item.review?.feedback : undefined;
	const hasDetails = Boolean(
		item.note || item.summary || item.verification || feedback || set !== null,
	);
	const collapsible = hasDetails;
	const [expanded, setExpanded] = useState(false);
	const consumedFocusTick = useRef(0);
	useEffect(() => {
		if (!focusRequest || focusRequest.id !== item.id || !collapsible) return;
		if (consumedFocusTick.current === focusRequest.tick) return;
		consumedFocusTick.current = focusRequest.tick;
		setExpanded(true);
	}, [focusRequest, item.id, collapsible]);
	const detailsClass = collapsible ? "hidden group-data-[expanded=true]:flex" : "flex";
	return (
		<li
			id={`plan-item-${item.id}`}
			data-testid="plan-item"
			data-status={item.status}
			data-reviewed={reviewed}
			data-reviewing={reviewing}
			data-changes-requested={changesRequested}
			data-expanded={collapsible ? expanded : undefined}
			className="group py-2"
		>
			<div className="flex items-start gap-8 rounded-[var(--radius-sm)] p-4 transition-colors group-hover:bg-control-bg-hovered">
				<span
					className="flex min-h-24 shrink-0 items-center"
					title={
						reviewing
							? "Reviewing — the reviewer agent is reading this step"
							: changesRequested
								? "Changes requested"
								: undefined
					}
				>
					{hideStatusGlyph ? (
						<span className="size-12 shrink-0" aria-hidden="true" />
					) : (
						<StatusIcon
							status={item.status}
							glance="working"
							reviewed={reviewed}
							reviewing={reviewing}
							changesRequested={changesRequested}
						/>
					)}
				</span>
				<div className="flex min-w-0 flex-1 flex-col gap-2">
					<div className="flex min-h-8 items-center gap-8">
						{collapsible ? (
							<button
								type="button"
								data-testid="plan-item-toggle"
								aria-expanded={expanded}
								onClick={() => setExpanded((v) => !v)}
								title={expanded ? "Hide this step's details" : "Show this step's details"}
								className="flex min-w-0 flex-1 items-center gap-8 rounded-[var(--radius-sm)] text-left"
							>
								<ChevronRight className="size-14 shrink-0 text-text-muted transition-transform group-data-[expanded=true]:rotate-90" />
								<span className="min-w-0 flex-1 break-words tr-title-section text-text-default">
									{item.title}
								</span>
							</button>
						) : (
							<span className="flex min-w-0 flex-1 items-center gap-8">
								<span className="size-14 shrink-0" />
								<span className="min-w-0 flex-1 break-words tr-title-section text-text-default">
									{item.title}
								</span>
							</span>
						)}
						{reviewing ? (
							<span
								data-testid="plan-item-reviewing"
								title="A review subagent is reading this step…"
								className="min-h-8 shrink-0 animate-pulse tr-text-metadata text-primary"
							>
								Reviewing…
							</span>
						) : changesRequested ? (
							<button
								type="button"
								data-testid="plan-item-changes-requested"
								title="The review demanded changes — open the Review tab for the findings"
								onClick={onOpenReview}
								className="flex min-h-8 shrink-0 items-center gap-2 tr-text-metadata text-feedback-warning underline-offset-2 hover:underline"
							>
								<CircleAlert className="size-14" />
								Changes requested
								{findings > 0 ? ` · ${findings}` : ""}
							</button>
						) : needsReview ? (
							<button
								type="button"
								data-testid="plan-start-review"
								disabled={startDisabled}
								title={
									startDisabled
										? "Another step is being reviewed — one review at a time"
										: undefined
								}
								onClick={() => onStartReview(item.id)}
								className="flex h-24 shrink-0 items-center rounded-[var(--radius-sm)] bg-control-primary-bg px-8 text-control-primary-text tr-text-action opacity-100 transition hover:bg-control-primary-bg-hovered focus-visible:opacity-100 disabled:bg-control-primary-disabled-bg disabled:text-control-primary-disabled-text [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100"
							>
								Start review
							</button>
						) : reviewed ? (
							<span
								data-testid="plan-item-verified"
								title="This step's changes were reviewed and approved"
								className="flex min-h-8 shrink-0 items-center gap-2 tr-text-metadata text-feedback-success"
							>
								<CircleCheck className="size-14" />
								Verified
							</span>
						) : null}
						{onRemove ? (
							<IconTooltip
								label={
									reviewing
										? "Reviewing… — wait for the review to finish before removing"
										: "Remove"
								}
							>
								<button
									type="button"
									data-testid="plan-item-remove"
									onClick={() => onRemove(item.id)}
									disabled={reviewing}
									aria-label="Remove"
									className="flex size-24 shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-text-muted opacity-0 transition-opacity hover:bg-container-elevated-bg hover:text-feedback-error focus-visible:opacity-100 group-hover:opacity-100 disabled:pointer-events-none disabled:opacity-0"
								>
									<Trash2 className="size-14" />
								</button>
							</IconTooltip>
						) : null}
					</div>
					{collapsible && (item.verification || set) ? (
						<span className="flex items-center gap-8 tr-text-metadata text-text-subtle group-data-[expanded=true]:hidden">
							<span className="size-14 shrink-0" />
							{item.verification ? <VerificationGlyph verification={item.verification} /> : null}
							{set ? (
								<span>
									{fileCount} {fileCount === 1 ? "file" : "files"}
								</span>
							) : null}
							{set?.kind === "commit" && counts ? (
								<span className="flex items-center gap-8 max-sm:hidden">
									<span className="tr-code-text">{set.sha.slice(0, 7)}</span>
									<DiffStatBadge added={counts.added} removed={counts.removed} />
								</span>
							) : null}
						</span>
					) : null}
				</div>
			</div>
			{hasDetails ? (
				<div
					className={`mt-2 ml-24 flex-col gap-2 border-border-default border-l pl-12 ${detailsClass}`}
				>
					{feedback ? (
						<div
							data-testid="plan-item-review-feedback"
							className="tr-text-metadata text-feedback-warning"
						>
							{feedback}
						</div>
					) : null}
					{item.note ? <div className="tr-text-metadata text-text-subtle">{item.note}</div> : null}
					{item.status === "done" && item.summary ? (
						<div data-testid="plan-item-summary">
							<Markdown text={item.summary} className={`tr-text-metadata ${SUMMARY_PROSE}`} />
						</div>
					) : null}
					{item.status === "done" && item.verification ? (
						<VerificationBadge verification={item.verification} />
					) : null}
					<ChangeSetBlock item={item} workspaceId={workspaceId} onOpenCommit={onOpenCommit} />
					<RevisionsBlock item={item} onOpenCommit={onOpenCommit} />
				</div>
			) : null}
		</li>
	);
}

const SUMMARY_PROSE = [
	"max-w-none break-words text-text-muted",
	"[&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
	"[&_p]:my-4 [&_strong]:text-text-default",
	"[&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2",
	"[&_ul]:my-4 [&_ul]:list-disc [&_ul]:pl-16 [&_ol]:my-4 [&_ol]:list-decimal [&_ol]:pl-16 [&_li]:my-2",
].join(" ");

function PlanSummary({ summary, stale = false }: { summary: string; stale?: boolean }) {
	const [open, setOpen] = useState(false);
	const clampable = summary.length > 160;
	const header = (
		<>
			<span className="tr-text-eyebrow text-text-subtle">Summary</span>
			{stale ? (
				<span
					data-testid="plan-summary-stale"
					title="Showing the last completed recap until the plan finishes again"
					className="flex items-center gap-4 tr-text-metadata text-text-muted"
				>
					<Loader2 className="size-14 shrink-0 animate-spin text-text-muted" />
					Updating…
				</span>
			) : null}
		</>
	);
	return (
		<div className={`${PLAN_CARD_CLASS} flex flex-col gap-8`}>
			{clampable ? (
				<button
					type="button"
					data-testid="plan-overall-summary-toggle"
					aria-expanded={open}
					title={open ? "Collapse the summary" : "Expand the summary"}
					onClick={() => setOpen((v) => !v)}
					className="flex w-full flex-wrap items-center gap-x-8 gap-y-2 text-left"
				>
					{header}
					<ChevronRight
						className={`ml-auto size-16 shrink-0 text-text-muted transition-transform ${
							open ? "rotate-90" : ""
						}`}
					/>
				</button>
			) : (
				<div className="flex flex-wrap items-center gap-x-8 gap-y-2">{header}</div>
			)}
			<div data-testid="plan-overall-summary">
				<Markdown
					text={summary}
					className={`tr-text-ui ${SUMMARY_PROSE} ${clampable && !open ? "line-clamp-2" : ""}`}
				/>
			</div>
		</div>
	);
}

function GroupSection({
	group,
	workspaceId,
	sessionId,
	onOpenCommit,
	onStartReview,
	onOpenReview,
	onRemove,
	reviewComments,
	startDisabled,
	focusRequest,
}: {
	group: TodoGroupItem;
	workspaceId: string;
	sessionId: string;
	onOpenCommit: (sha: string) => void;
	onStartReview: (id: string) => Promise<void>;
	onOpenReview: () => void;
	onRemove?: ((id: string) => void) | undefined;
	reviewComments: ReviewComment[] | undefined;
	startDisabled: boolean;
	focusRequest: { id: string; tick: number } | null;
}) {
	const { done, total } = groupProgress(group);
	return (
		<section className="mb-16" data-testid="plan-group">
			<h2 className="mb-4 flex items-baseline gap-8 border-border-default border-b pb-4 tr-title-dialog text-text-default">
				<span className="min-w-0 flex-1 break-words">{group.title}</span>
				<span className="shrink-0 tr-text-eyebrow text-text-subtle">
					{done}/{total}
				</span>
			</h2>
			<ul className="flex flex-col">
				{group.todos.map((item) => (
					<ItemBlock
						key={item.id}
						item={item}
						workspaceId={workspaceId}
						sessionId={sessionId}
						onOpenCommit={onOpenCommit}
						onStartReview={onStartReview}
						onOpenReview={onOpenReview}
						onRemove={onRemove}
						reviewComments={reviewComments}
						startDisabled={startDisabled}
						focusRequest={focusRequest}
					/>
				))}
			</ul>
		</section>
	);
}

function downloadMarkdown(markdown: string, title: string): void {
	const blob = new Blob([markdown], { type: "text/markdown" });
	const url = URL.createObjectURL(blob);
	const a = document.createElement("a");
	a.href = url;
	a.download = `plan-${title.replace(/[^\w-]+/g, "-").toLowerCase() || "chat"}.md`;
	a.click();
	URL.revokeObjectURL(url);
}

// One inline textarea composer for the plan: Enter submits, Shift+Enter newlines, Esc closes (when
// closable). Used both for adding TODOs and for the chat/steer field in the Session block.
function PlanComposer({
	icon: Icon,
	placeholder,
	testId,
	autoFocus = false,
	onSubmit,
	onClose,
}: {
	icon: typeof Plus;
	placeholder: string;
	testId: string;
	autoFocus?: boolean;
	onSubmit: (text: string) => Promise<void> | void;
	onClose?: (() => void) | undefined;
}) {
	const [draft, setDraft] = useState("");
	const inputRef = useRef<HTMLTextAreaElement>(null);
	useEffect(() => {
		if (autoFocus) inputRef.current?.focus();
	}, [autoFocus]);
	const submit = async () => {
		const text = draft.trim();
		if (!text) return;
		try {
			await onSubmit(text);
			setDraft("");
		} catch {}
	};
	return (
		<div className="mt-8 flex items-start gap-8 rounded-[var(--radius-sm)] border border-control-border-default bg-control-bg px-12 py-8 transition-colors focus-within:border-control-border-active">
			<Icon className="mt-2 size-14 shrink-0 text-text-muted" />
			<textarea
				ref={inputRef}
				data-testid={testId}
				rows={1}
				value={draft}
				onChange={(e) => setDraft(e.target.value)}
				onKeyDown={(e) => {
					if (e.key === "Enter" && !e.shiftKey) {
						e.preventDefault();
						void submit();
					} else if (e.key === "Escape" && onClose) {
						onClose();
					}
				}}
				placeholder={placeholder}
				className="field-sizing-content max-h-[10rem] min-w-0 flex-1 resize-none overflow-x-hidden overflow-y-auto bg-transparent tr-text-ui text-text-default outline-none placeholder:text-text-muted"
			/>
		</div>
	);
}

function PlanCardSection({
	testId,
	label,
	Icon,
	iconClass,
	children,
}: {
	testId: string;
	label: string;
	Icon: typeof CircleDot;
	iconClass: string;
	children: ReactNode;
}) {
	return (
		<section data-testid={testId} className={PLAN_CARD_CLASS}>
			<div className="mb-8 flex items-center gap-8">
				<Icon className={`size-14 shrink-0 ${iconClass}`} />
				<h2 className="min-w-0 flex-1 tr-title-dialog text-text-default">{label}</h2>
			</div>
			{children}
		</section>
	);
}

// The Session block's LIVE slot. Subscribes to the session runtime itself (isolating re-renders from
// the heavy PlanPane). Shows the pending question as the SAME `AskUserQuestionCard` the chat uses
// (answerable in place via a real `session.answerQuestion`, chat-only actions no-op); otherwise, when
// no plan item is in progress (`showAgentMessage`), shows the agent's latest message so the plan stays
// transparent about what it's doing when it isn't asking or on a step. Renders nothing when neither.
function PlanSessionLive({
	sessionId,
	showAgentMessage,
}: {
	workspaceId: string;
	sessionId: string;
	showAgentMessage: boolean;
}) {
	const runtime = useAppStore((s) => s.sessions[sessionId]);
	const focusScope = useRef({}).current;
	const actions = useMemo<ChatActions>(
		() => ({
			answerQuestion: (toolCallId, result) =>
				getTransport()
					.request("session.answerQuestion", { sessionId, toolCallId, result })
					.then(() => undefined),
			cancelAutomaticReveal: () => {},
			focusComposer: () => {},
			openSubagentTranscript: () => {},
			revealChatElement: () => {},
		}),
		[sessionId],
	);
	const askStates = useMemo(
		() => (runtime ? deriveAskStates(runtime.turns, runtime.askAnswers, runtime.toolResults) : {}),
		[runtime],
	);
	const ask = runtime ? pendingAsk(runtime) : undefined;
	if (ask) {
		return (
			<ChatActionsContext.Provider value={actions}>
				<AskStatesContext.Provider value={{ states: askStates, focusScope }}>
					<div data-testid="plan-ask" className="mb-8">
						<AskUserQuestionCard
							toolCallId={ask.toolCallId}
							toolName="ask_user_question"
							args={ask.args}
							result={ask.result}
							status={ask.status}
							streaming={ask.streaming}
						/>
					</div>
				</AskStatesContext.Provider>
			</ChatActionsContext.Provider>
		);
	}
	const message = showAgentMessage && runtime ? lastAgentText(runtime) : undefined;
	if (!message) return null;
	return (
		<div data-testid="plan-agent-message" className="mb-8 flex items-start gap-8 px-4">
			<MessageSquare className="mt-2 size-14 shrink-0 text-text-muted" />
			<div className="min-w-0 flex-1">
				<div className="tr-text-eyebrow text-text-muted">Agent</div>
				<Markdown text={message} className={`line-clamp-4 tr-text-metadata ${SUMMARY_PROSE}`} />
			</div>
		</div>
	);
}

function SessionBlock({
	activeGroups,
	activeLoose,
	pendingGroups,
	pendingLoose,
	allDone,
	glance,
	renderLive,
	onAdd,
	onOpenChat,
	onSend,
	renderGroup,
	renderItem,
}: {
	activeGroups: TodoGroupItem[];
	activeLoose: TodoItem[];
	pendingGroups: TodoGroupItem[];
	pendingLoose: TodoItem[];
	allDone: boolean;
	glance: PlanGlance;
	renderLive: (showAgentMessage: boolean) => ReactNode;
	onAdd: (title: string) => Promise<void>;
	onOpenChat: () => void;
	onSend: (text: string) => Promise<void> | void;
	renderGroup: (group: TodoGroupItem) => ReactNode;
	renderItem: (item: TodoItem) => ReactNode;
}) {
	const [adding, setAdding] = useState(false);
	const hasActive = activeGroups.length > 0 || activeLoose.length > 0;
	const hasPending = pendingGroups.length > 0 || pendingLoose.length > 0;
	const hasAny = hasActive || hasPending;
	return (
		<section data-testid="plan-now-executing" className={PLAN_CARD_CLASS}>
			<div className="mb-8 flex items-center gap-8">
				<CircleDot className="size-14 shrink-0 text-primary" />
				<h2 className="shrink-0 tr-title-dialog text-text-default">Session</h2>
				{glance === "working" ? (
					<button
						type="button"
						data-testid="plan-now-status"
						data-glance="working"
						onClick={onOpenChat}
						title="Open the chat"
						className="flex min-w-0 items-center gap-4 tr-text-metadata text-text-subtle underline-offset-2 hover:text-text-default hover:underline"
					>
						<Loader2 className="size-14 shrink-0 animate-spin text-primary" />
						Working…
					</button>
				) : glance === "waiting_question" ? (
					<button
						type="button"
						data-testid="plan-now-status"
						data-glance="waiting_question"
						onClick={onOpenChat}
						title="Open the chat"
						className="flex min-w-0 items-center gap-4 tr-text-metadata text-primary underline-offset-2 hover:underline"
					>
						<MessageCircleQuestion className="size-14 shrink-0" />
						Question
					</button>
				) : null}
				<button
					type="button"
					data-testid="plan-add-task"
					onClick={() => setAdding((v) => !v)}
					title="Add a task to the plan"
					className="ml-auto flex h-24 shrink-0 items-center gap-4 rounded-[var(--radius-sm)] px-8 tr-text-action text-text-muted transition-colors hover:bg-control-bg-hovered hover:text-text-default"
				>
					<Plus className="size-14" />
					Task
				</button>
			</div>
			{renderLive(!hasActive)}
			{hasActive ? (
				<>
					{activeGroups.map(renderGroup)}
					{activeLoose.length > 0 ? (
						<ul className="flex flex-col">{activeLoose.map(renderItem)}</ul>
					) : null}
				</>
			) : null}
			{hasPending ? (
				<>
					{pendingGroups.map(renderGroup)}
					{pendingLoose.length > 0 ? (
						<ul className="flex flex-col">{pendingLoose.map(renderItem)}</ul>
					) : null}
				</>
			) : null}
			{glance === "waiting_question" ? null : glance === "waiting" && !hasAny && !allDone ? (
				!adding ? (
					<button
						type="button"
						data-testid="plan-now-idle"
						data-glance="waiting"
						onClick={() => setAdding(true)}
						title="Add a task"
						className="group flex w-full items-center gap-8 rounded-[var(--radius-sm)] px-4 py-2 text-left tr-text-ui text-text-subtle transition-colors hover:bg-control-bg-hovered hover:text-text-default"
					>
						<span className="min-w-0 flex-1">No steps yet — add one to get started.</span>
						<span className="flex shrink-0 items-center gap-4 text-text-muted opacity-0 transition-opacity group-hover:opacity-100">
							<Plus className="size-14" />
							Add a task
						</span>
					</button>
				) : null
			) : (
				<PlanComposer
					icon={MessageSquare}
					testId="plan-session-chat"
					placeholder={
						glance === "working"
							? "Steer the agent…  (Enter to send, Shift+Enter for a new line)"
							: "Message the agent…  (Enter to send, Shift+Enter for a new line)"
					}
					onSubmit={onSend}
				/>
			)}
			{adding ? (
				<PlanComposer
					icon={Plus}
					testId="plan-add-input"
					placeholder="Add a task…  (Enter to add, Shift+Enter for a new line)"
					autoFocus
					onSubmit={onAdd}
					onClose={() => setAdding(false)}
				/>
			) : null}
		</section>
	);
}

export default function PlanPane({
	workspaceId,
	sessionId,
}: {
	workspaceId: string;
	sessionId: string;
}) {
	const plan = useChatTodos(workspaceId, sessionId);
	const title = useAppStore((s) => selectChatTitle(s, workspaceId, sessionId));
	const pushToast = useAppStore((s) => s.pushToast);
	const requestToolView = useAppStore((s) => s.requestToolView);
	const workspace = useAppStore((s) => selectWorkspaceById(s, workspaceId));
	const glance = useAppStore((s): PlanGlance => {
		const rt = s.sessions[sessionId];
		return rt ? sessionGlance(rt) : "waiting";
	});
	const connection = useAppStore((s) => s.status);
	const hostPlatform = useAppStore((s) => s.hostPlatform);
	const canReview = supportsPlanReview(useAppStore((s) => s.protocolVersion));
	const {
		review: openReview,
		url: openReviewUrl,
		noteOpenReview,
		refreshOpenReview,
	} = useOpenBranchReview(workspace, connection);
	const [prBusy, setPrBusy] = useState(false);
	const [prSetup, setPrSetup] = useState<PrSetupState | null>(null);
	const [prCompose, setPrCompose] = useState<PrComposeState | null>(null);
	const lastPrSubmit = useRef<{
		draft: boolean;
		title?: string | undefined;
		body?: string | undefined;
		titleEdited: boolean;
	} | null>(null);
	const [focusRequest, setFocusRequest] = useState<{ id: string; tick: number } | null>(null);
	const agentComments = useAppStore((s) => selectAgentReviewCommentCount(s, workspaceId));
	const reviewComments = useAppStore((s) => s.reviewsByWorkspace[workspaceId]?.comments);

	if (plan.data === null) {
		if (plan.failed) {
			return (
				<div className="flex h-full items-center justify-center text-text-subtle tr-text-ui">
					Couldn't load the plan.
				</div>
			);
		}
		return <LoadingRegion rows={8} className="h-full p-12" />;
	}
	const data = plan.data;
	const { done, total } = planSummary(data);
	const sections = planSections(data);
	const adopted = adoptedCommits(data);
	const reviewables = reviewableItems(data);
	const unsettledReviewables = reviewables.filter((t) => !reviewSettled(t));
	const reviewedCount = reviewables.length - unsettledReviewables.length;
	const onOpenCommit = (sha: string) => plan.openChanges({ sha });
	const onOpenReview = () => requestToolView(workspaceId, "review");
	const reviewingAny = reviewables.some((t) => t.review?.reviewing === true);
	const planReady = isPlanReady(data);
	const sameBranch = Boolean(
		workspace && workspace.branch === workspace.baseBranch.replace(/^origin\//, ""),
	);
	const allItems = [...flatItems(data), ...adopted];
	const commitCount = allItems.reduce((n, t) => n + itemRevisions(t).length, 0);
	const flagged = allItems.filter((t) => reviewChangesRequested(t) && t.review?.reviewing !== true);
	const jumpToItem = (id: string) => {
		setFocusRequest((prev) => ({ id, tick: (prev?.tick ?? 0) + 1 }));
		document
			.getElementById(`plan-item-${id}`)
			?.scrollIntoView({ behavior: "smooth", block: "center" });
	};
	const buildDone = total > 0 && done === total;
	const staleSummary = planStaleSummary(data);
	// The Summary card shows ONLY the agent's prose (fresh when all-done, else the stale note). No prose
	// → no card (the header stepper already carries the step/file/review counts).
	const summaryProse = buildDone ? planCompletionSummary(data) : staleSummary;
	const stages: { build: StageState; review: StageState; pr: StageState } = {
		build: buildDone ? "done" : "active",
		review:
			reviewables.length > 0 && unsettledReviewables.length === 0
				? "done"
				: buildDone || reviewedCount > 0
					? "active"
					: "pending",
		pr: openReview ? "done" : planReady ? "active" : "pending",
	};
	const unpushed = openReview?.unpushedCommits ?? 0;
	const openPrFlow = async (draft: boolean): Promise<void> => {
		if (openReview) {
			await submitPr({ draft: false });
			return;
		}
		const edited = lastPrSubmit.current;
		if (
			edited &&
			edited.title !== undefined &&
			edited.body !== undefined &&
			edited.draft === draft
		) {
			setPrCompose({
				draft,
				title: edited.title,
				body: edited.body,
				titleEdited: edited.titleEdited,
			});
			return;
		}
		setPrBusy(true);
		try {
			const preview = await getTransport().request("pr.preview", { workspaceId, sessionId, title });
			setPrCompose({ draft, ...preview });
		} catch (err) {
			pushToast({ variant: "error", title: "Couldn't prepare the PR", message: errorText(err) });
		} finally {
			setPrBusy(false);
		}
	};
	const submitPr = async (opts: {
		draft: boolean;
		title?: string | undefined;
		body?: string | undefined;
		titleEdited?: boolean | undefined;
	}): Promise<void> => {
		const { draft, title: prTitle, body: prBody, titleEdited } = opts;
		lastPrSubmit.current = {
			draft,
			title: prTitle,
			body: prBody,
			titleEdited: Boolean(titleEdited),
		};
		setPrBusy(true);
		try {
			const result = await getTransport().request(
				"pr.open",
				{
					workspaceId,
					sessionId,
					...(prTitle !== undefined ? { title: prTitle } : {}),
					...(titleEdited ? { titleEdited: true } : {}),
					...(prBody !== undefined ? { body: prBody } : {}),
					...(draft ? { draft: true } : {}),
				},
				{ timeoutMs: 180_000 },
			);
			setPrCompose(null);
			if (result.review) noteOpenReview(result.review, result.url);
			refreshOpenReview();
			const dirty =
				result.dirtyFiles > 0
					? `${result.dirtyFiles} uncommitted ${result.dirtyFiles === 1 ? "file" : "files"} stayed local.`
					: "";
			if (dirty) pushToast({ variant: "info", title: "Uncommitted changes", message: dirty });
			if (result.action === "compare" && result.ghProblem) {
				setPrSetup({
					kind: "gh",
					problem: result.ghProblem,
					...(result.compareUrl ? { compareUrl: result.compareUrl } : {}),
				});
				return;
			}
			lastPrSubmit.current = null;
			if (result.action === "compare" && result.compareUrl) {
				window.open(result.compareUrl, "_blank", "noopener,noreferrer");
			}
			const toastByAction = {
				created: {
					title: "PR opened",
					message: `${result.review ? openReviewLabel(result.review) : "The PR"} is open — its description came from this plan.`,
				},
				updated: {
					title: "PR updated",
					message: `Pushed new commits to ${result.review ? openReviewLabel(result.review) : "the open PR"}${result.bodyRefreshed === false ? " — refreshing its description failed." : " and refreshed its description."}`,
				},
				pushed: {
					title: "Branch pushed",
					message:
						"The branch is on origin. The remote isn't GitHub — open the review on your forge.",
				},
				compare: {
					title: "Branch pushed",
					message:
						"GitHub's compare page opened with the plan prefilled — finish creating the PR there.",
				},
			} as const;
			pushToast({ variant: "success", ...toastByAction[result.action] });
		} catch (err) {
			if (wsErrorCode(err) === "PUSH_AUTH_FAILED") {
				setPrCompose(null);
				setPrSetup({ kind: "push-auth", detail: errorText(err) });
			} else {
				pushToast({ variant: "error", title: "Open PR failed", message: errorText(err) });
			}
		} finally {
			setPrBusy(false);
		}
	};
	const retryPrSetup = () => {
		setPrSetup(null);
		const last = lastPrSubmit.current;
		if (last) void submitPr(last);
	};
	const runPrSetupCommand = (command: string) => {
		setPrSetup(null);
		useAppStore.getState().addTerminal(workspaceId, command);
	};
	const startReview = async (id: string): Promise<void> =>
		plan.startReview(id).then(
			() => {
				pushToast({
					variant: "success",
					title: "Review started",
					message: "The reviewer agent is reading this step — findings land in the Review tab.",
				});
			},
			(err) => {
				pushToast({
					variant: "error",
					title: "Review didn't start",
					message: errorText(err),
				});
			},
		);
	const reviewAll = async (): Promise<void> =>
		plan.reviewAll().then(
			({ total, alreadyRunning }) => {
				pushToast(
					alreadyRunning
						? {
								variant: "info",
								title: "Review All is already running",
								message: "The current pass continues — the per-row Reviewing… pulses track it.",
							}
						: total > 0
							? {
									variant: "success",
									title: "Review All started",
									message: `Reviewing ${total} step${total === 1 ? "" : "s"} one at a time — findings land in the Review tab.`,
								}
							: {
									variant: "info",
									title: "Nothing to review",
									message: "Every reviewable step is already reviewed.",
								},
				);
			},
			(err) => {
				pushToast({ variant: "error", title: "Review All didn't start", message: errorText(err) });
			},
		);
	const copyMarkdown = () => {
		void navigator.clipboard
			.writeText(exportMarkdown())
			.then(() =>
				pushToast({
					variant: "success",
					title: "Plan copied",
					message: "Markdown is in your clipboard.",
				}),
			)
			.catch(() =>
				pushToast({
					variant: "error",
					title: "Copy failed",
					message: "Couldn't write to the clipboard.",
				}),
			);
	};
	const exportMarkdown = () => planToMarkdown(data, title);
	const renderGroup = (group: TodoGroupItem): ReactNode => (
		<GroupSection
			key={group.id}
			group={group}
			workspaceId={workspaceId}
			sessionId={sessionId}
			onOpenCommit={onOpenCommit}
			onStartReview={startReview}
			onOpenReview={onOpenReview}
			onRemove={plan.remove}
			reviewComments={reviewComments}
			startDisabled={reviewingAny || !canReview}
			focusRequest={focusRequest}
		/>
	);
	const renderItem = (item: TodoItem): ReactNode => (
		<ItemBlock
			key={item.id}
			item={item}
			workspaceId={workspaceId}
			sessionId={sessionId}
			onOpenCommit={onOpenCommit}
			onStartReview={startReview}
			onOpenReview={onOpenReview}
			onRemove={plan.remove}
			reviewComments={reviewComments}
			startDisabled={reviewingAny || !canReview}
			focusRequest={focusRequest}
		/>
	);

	return (
		<div
			data-testid="plan-pane"
			className="h-full overflow-auto bg-container-content-bg motion-safe:animate-reveal"
		>
			<PrComposeDialog
				state={prCompose}
				updating={Boolean(openReview)}
				busy={prBusy}
				onClose={() => {
					setPrCompose(null);
					lastPrSubmit.current = null;
				}}
				onSubmit={(prTitle, prBody, titleEdited) => {
					if (prCompose)
						void submitPr({ draft: prCompose.draft, title: prTitle, body: prBody, titleEdited });
				}}
			/>
			<PrSetupDialog
				state={prSetup}
				platform={hostPlatform}
				onClose={() => setPrSetup(null)}
				onRetry={retryPrSetup}
				onRun={runPrSetupCommand}
				onCompareOpen={() => {
					setPrSetup(null);
					lastPrSubmit.current = null;
				}}
			/>
			<div className="mx-auto max-w-[52rem] px-16 py-16">
				<header className="mb-16 flex items-center gap-12">
					<div className="min-w-0 flex-1">
						<h1 className="truncate tr-heading-sm text-text-default">Plan · {title}</h1>
						<div
							data-testid="plan-progress"
							className="flex flex-wrap items-center gap-4 tr-text-metadata text-text-subtle"
						>
							<StageGlyph state={stages.build} />
							<span>
								{done}/{total} done
							</span>
							{reviewables.length > 0 ? (
								<>
									<ChevronRight className="size-12 shrink-0 text-text-muted" />
									<span data-testid="plan-review-progress" className="flex items-center gap-4">
										<StageGlyph state={stages.review} />
										{reviewedCount}/{reviewables.length} reviewed
									</span>
								</>
							) : null}
							<ChevronRight className="size-12 shrink-0 text-text-muted" />
							<span
								data-testid="plan-pr-stage"
								data-state={stages.pr}
								className="flex items-center gap-4"
							>
								<StageGlyph state={stages.pr} />
								{openReview ? openReviewLabel(openReview) : "PR"}
							</span>
						</div>
						{workspace ? (
							<div
								data-testid="plan-context"
								className="mt-2 flex flex-wrap items-center gap-8 tr-text-metadata text-text-subtle"
							>
								<span className="flex min-w-0 items-center gap-4">
									<GitBranch className="size-12 shrink-0" />
									<span className="truncate">
										{workspace.baseBranch} ← {workspace.branch}
									</span>
								</span>
								<PlanCommitsMenu
									workspaceId={workspaceId}
									reloadSignal={commitCount}
									onOpenCommit={onOpenCommit}
								/>
								{workspace.diffStats ? (
									<DiffStatBadge
										added={workspace.diffStats.added}
										removed={workspace.diffStats.removed}
									/>
								) : null}
							</div>
						) : null}
					</div>
					{agentComments > 0 ? (
						<button
							type="button"
							data-testid="plan-review-comments"
							onClick={onOpenReview}
							title="Open the Review tab — the reviewer's findings"
							className="flex h-32 shrink-0 items-center gap-4 rounded-[var(--radius-sm)] px-8 tr-text-ui text-text-muted transition-colors hover:bg-control-bg-hovered hover:text-text-default"
						>
							<MessageSquare className="size-14" />
							{agentComments} {agentComments === 1 ? "comment" : "comments"}
						</button>
					) : null}
					{openReview ? (
						openReviewUrl ? (
							<a
								data-testid="plan-pr-chip"
								href={openReviewUrl}
								target="_blank"
								rel="noopener noreferrer"
								className="flex h-32 shrink-0 items-center rounded-[var(--radius-sm)] px-8 tr-text-ui text-text-muted transition-colors hover:bg-control-bg-hovered hover:text-text-default"
							>
								{openReviewLabel(openReview)}
							</a>
						) : (
							<span
								data-testid="plan-pr-chip"
								className="flex h-32 shrink-0 items-center px-8 tr-text-ui text-text-muted"
							>
								{openReviewLabel(openReview)}
							</span>
						)
					) : null}
					<button
						type="button"
						data-testid="plan-open-pr"
						disabled={prBusy || sameBranch}
						onClick={() => void openPrFlow(false)}
						title={
							sameBranch
								? "This workspace's branch is its base branch — there's nothing to open a PR against."
								: openReview
									? "Push new commits to the open PR and refresh its description from the plan"
									: "Push the branch and open a PR whose description comes from this plan"
						}
						className={`flex h-32 shrink-0 items-center gap-4 rounded-[var(--radius-sm)] px-8 tr-text-ui transition-colors ${
							(planReady && !openReview) || unpushed > 0
								? "bg-control-primary-bg text-control-primary-text hover:bg-control-primary-bg-hovered disabled:bg-control-primary-disabled-bg disabled:text-control-primary-disabled-text"
								: "text-text-muted hover:bg-control-bg-hovered hover:text-text-default disabled:text-control-disabled-text"
						}`}
					>
						{prBusy ? (
							<Loader2 className="size-14 animate-spin" />
						) : (
							<GitPullRequestArrow className="size-14" />
						)}
						{prBusy && (prCompose || openReview)
							? "Pushing…"
							: openReview
								? unpushed > 0
									? `Push updates (${unpushed})`
									: "Push updates"
								: "Open PR"}
					</button>
					<DropdownMenu>
						<DropdownMenuTrigger
							data-testid="plan-menu"
							aria-label="Plan actions"
							className="flex size-32 shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-text-muted outline-none hover:bg-control-bg-hovered hover:text-text-default focus-visible:ring-2 focus-visible:ring-primary data-[state=open]:bg-control-bg-hovered"
						>
							<MoreVertical className="size-16" />
						</DropdownMenuTrigger>
						<DropdownMenuContent align="end" data-testid="plan-menu-content">
							<DropdownMenuItem data-testid="plan-copy-markdown" onSelect={() => copyMarkdown()}>
								<Copy />
								Copy
							</DropdownMenuItem>
							<DropdownMenuItem
								data-testid="plan-save-markdown"
								onSelect={() => downloadMarkdown(exportMarkdown(), title)}
							>
								<Download />
								Save .md
							</DropdownMenuItem>
							{!openReview ? (
								<DropdownMenuItem
									data-testid="plan-open-draft-pr"
									disabled={prBusy || sameBranch}
									onSelect={() => void openPrFlow(true)}
								>
									<GitPullRequestArrow />
									Open draft PR
								</DropdownMenuItem>
							) : null}
							{reviewables.length > 0 ? (
								<>
									<DropdownMenuSeparator />
									<DropdownMenuItem
										data-testid="plan-review-all"
										disabled={unsettledReviewables.length === 0 || reviewingAny || !canReview}
										onSelect={() => void reviewAll()}
									>
										<ListChecks />
										Review All
										{unsettledReviewables.length > 0 ? ` (${unsettledReviewables.length})` : ""}
									</DropdownMenuItem>
								</>
							) : null}
						</DropdownMenuContent>
					</DropdownMenu>
				</header>
				{flagged.length > 0 ? (
					<div data-testid="plan-next-action" data-kind="fix" className={NEXT_ACTION_CLASS}>
						<CircleAlert className="size-16 shrink-0 text-feedback-warning" />
						<span className="min-w-0 flex-1 tr-text-ui text-text-default">
							{flagged.length === 1 ? "1 step needs" : `${flagged.length} steps need`} fixes — the
							review requested changes.
						</span>
						<button
							type="button"
							data-testid="plan-next-action-go"
							onClick={() => flagged[0] && jumpToItem(flagged[0].id)}
							className={NEXT_ACTION_BUTTON_CLASS}
						>
							Show step
						</button>
					</div>
				) : unsettledReviewables.length > 0 ? (
					<div data-testid="plan-next-action" data-kind="review" className={NEXT_ACTION_CLASS}>
						<ListChecks className="size-16 shrink-0 text-primary" />
						<span className="min-w-0 flex-1 tr-text-ui text-text-default">
							{unsettledReviewables.length === 1
								? "1 step awaits"
								: `${unsettledReviewables.length} steps await`}{" "}
							review — run the agent reviewer.
						</span>
						<button
							type="button"
							data-testid="plan-next-action-go"
							disabled={reviewingAny || !canReview}
							onClick={() => void reviewAll()}
							className={NEXT_ACTION_BUTTON_CLASS}
						>
							Review All
						</button>
					</div>
				) : openReview && unpushed > 0 ? (
					<div data-testid="plan-next-action" data-kind="push" className={NEXT_ACTION_CLASS}>
						<GitPullRequestArrow className="size-16 shrink-0 text-primary" />
						<span className="min-w-0 flex-1 tr-text-ui text-text-default">
							{unpushed === 1 ? "1 new commit isn't" : `${unpushed} new commits aren't`} in{" "}
							{openReviewLabel(openReview)} yet.
						</span>
						<button
							type="button"
							data-testid="plan-next-action-go"
							disabled={prBusy}
							onClick={() => void openPrFlow(false)}
							className={NEXT_ACTION_BUTTON_CLASS}
						>
							Push updates
						</button>
					</div>
				) : planReady && !openReview && !sameBranch ? (
					<div data-testid="plan-next-action" data-kind="ship" className={NEXT_ACTION_CLASS}>
						<GitPullRequestArrow className="size-16 shrink-0 text-feedback-success" />
						<span className="min-w-0 flex-1 tr-text-ui text-text-default">
							All steps are done and reviewed — ready to ship.
						</span>
						<button
							type="button"
							data-testid="plan-next-action-go"
							disabled={prBusy}
							onClick={() => void openPrFlow(false)}
							className={NEXT_ACTION_BUTTON_CLASS}
						>
							Open PR
						</button>
					</div>
				) : null}
				{summaryProse ? <PlanSummary summary={summaryProse} stale={!buildDone} /> : null}
				<SessionBlock
					activeGroups={sections.activeGroups}
					activeLoose={sections.activeLoose}
					pendingGroups={sections.pendingGroups}
					pendingLoose={sections.pendingLoose}
					allDone={buildDone}
					glance={glance}
					renderLive={(showAgentMessage) => (
						<PlanSessionLive
							workspaceId={workspaceId}
							sessionId={sessionId}
							showAgentMessage={showAgentMessage}
						/>
					)}
					onAdd={plan.add}
					onOpenChat={() => void openChatInTab(workspaceId, sessionId)}
					onSend={async (text) => {
						// Behaves like the chat composer: steer a running agent, otherwise start a new turn —
						// then hand off to the chat where the reply streams.
						const streaming = useAppStore.getState().sessions[sessionId]?.isStreaming ?? false;
						void openChatInTab(workspaceId, sessionId);
						await getTransport().request(streaming ? "session.steer" : "session.prompt", {
							sessionId,
							text,
						});
					}}
					renderGroup={renderGroup}
					renderItem={renderItem}
				/>
				{sections.doneGroups.length > 0 || sections.doneLoose.length > 0 ? (
					<PlanCardSection
						testId="plan-done-section"
						label="Done"
						Icon={CircleCheck}
						iconClass="text-feedback-success"
					>
						{sections.doneGroups.map(renderGroup)}
						{sections.doneLoose.length > 0 ? (
							<ul className="flex flex-col">{sections.doneLoose.map(renderItem)}</ul>
						) : null}
					</PlanCardSection>
				) : null}
				{adopted.length > 0 ? (
					<section className="mb-16" data-testid="plan-adopted-commits">
						<h2 className="mb-4 flex items-baseline gap-8 border-border-default border-b pb-4 tr-title-dialog text-text-default">
							<span className="min-w-0 flex-1 truncate">Committed outside the plan</span>
							<span className="shrink-0 tr-text-eyebrow text-text-subtle">
								{adopted.length} {adopted.length === 1 ? "commit" : "commits"}
							</span>
						</h2>
						<p className="mb-4 px-4 tr-text-metadata text-text-subtle">
							Commits no step claims — review them too.
						</p>
						<ul className="flex flex-col">
							{adopted.map((item) => (
								<ItemBlock
									key={item.id}
									item={item}
									workspaceId={workspaceId}
									sessionId={sessionId}
									onOpenCommit={onOpenCommit}
									onStartReview={startReview}
									onOpenReview={onOpenReview}
									reviewComments={reviewComments}
									startDisabled={reviewingAny || !canReview}
									focusRequest={focusRequest}
								/>
							))}
						</ul>
					</section>
				) : null}
				{data.unattributed && data.unattributed.length > 0 ? (
					<section className="mb-16" data-testid="plan-unattributed">
						<h2 className="mb-4 flex items-baseline gap-8 border-border-default border-b pb-4 tr-title-dialog text-text-default">
							<span className="min-w-0 flex-1 truncate">Outside the plan</span>
							<span className="shrink-0 tr-text-eyebrow text-text-subtle">
								{data.unattributed.length} {data.unattributed.length === 1 ? "file" : "files"}
							</span>
						</h2>
						<p className="mb-4 px-4 tr-text-metadata text-text-subtle">
							Uncommitted changes no step claims — review them too.
						</p>
						<ul className="flex flex-col">
							{data.unattributed.map((file) => (
								<FileRow
									key={file.path}
									file={file}
									onOpen={() =>
										void openDiffInTab(workspaceId, { kind: "uncommitted" }, file.path, "preview")
									}
								/>
							))}
						</ul>
					</section>
				) : null}
			</div>
		</div>
	);
}
