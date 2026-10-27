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
} from "@remixicon/react";
import type { ReviewComment, TodoGroupItem, TodoItem } from "@thinkrail/contracts";
import { useT } from "@thinkrail/locales/react";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@thinkrail/ui/dropdown-menu";
import { LoadingRegion } from "@thinkrail/ui/skeleton";
import { IconTooltip } from "@thinkrail/ui/tooltip";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { type ChatActions, ChatActionsContext } from "../chat/ChatActions";
import {
	awaitingToolCallIdOf,
	deriveInteractionStates,
	InteractionStatesContext,
} from "../chat/interactionState";
import { Markdown } from "../chat/Markdown";
import { SectionLabel, VerificationBadge, VerificationGlyph } from "../chat/planKit";
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
	type PendingInteraction,
	type PlanGlance,
	pendingInteraction,
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
import { useToolInteraction } from "../chat/toolInteraction";
import { getToolRenderer } from "../chat/toolRegistry";
import { hydrateSessionRuntime, useChatTodos } from "../chat/useChatTodos";
import {
	selectAgentReviewCommentCount,
	selectChatName,
	selectChatTitle,
	selectWorkspaceById,
	useAppStore,
} from "../store";
import { errorText, getTransport, supportsPlanReview } from "../transport";
import { DiffStatBadge } from "./DiffStatBadge";
import { openChatInTab } from "./openChat";
import { openDiffInTab } from "./openTabs";
import { PlanCommitsMenu } from "./PlanCommitsMenu";
import { FileRow } from "./planFileRow";
import {
	isOpenBranchReview,
	openReviewLabel,
	resolveBranchReview,
	useBranchStatus,
} from "./useBranchStatus";
import { useShipRunner } from "./useShipRunner";

function ChangeSetBlock({
	item,
	workspaceId,
	onOpenCommit,
}: {
	item: TodoItem;
	workspaceId: string;
	onOpenCommit: (sha: string) => void;
}) {
	const t = useT();
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
				<IconTooltip
					label={expanded ? t("plan.changeSet.hideFiles") : t("plan.changeSet.showFiles")}
				>
					<button
						type="button"
						data-testid="plan-change-set-toggle"
						aria-expanded={expanded}
						onClick={() => setExpanded((v) => !v)}
						className="flex min-h-32 min-w-0 items-center gap-4 rounded-sm px-4 py-2 text-left hover:bg-control-bg-hovered"
					>
						<Chevron className="size-16 shrink-0 text-text-muted" />
						<span className="shrink-0 tr-text-metadata text-text-subtle">
							{t("plan.fileCount", { count })}
						</span>
					</button>
				</IconTooltip>
				{set.kind === "commit" ? (
					<>
						<IconTooltip label={t("plan.changeSet.openCommit")}>
							<button
								type="button"
								data-testid="plan-commit-chip"
								onClick={() => onOpenCommit(set.sha)}
								className="flex min-h-32 shrink-0 items-center gap-4 rounded-sm px-4 py-2 tr-code-text text-text-subtle hover:bg-control-bg-hovered hover:text-text-default"
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
	"mb-16 rounded-md border border-border-default bg-container-elevated-bg p-12";
const NEXT_ACTION_CLASS = `${PLAN_CARD_CLASS} flex items-center gap-8`;
const NEXT_ACTION_BUTTON_CLASS =
	"flex h-28 shrink-0 items-center rounded-sm bg-control-primary-bg px-8 tr-text-ui text-control-primary-text transition-colors hover:bg-control-primary-bg-hovered disabled:bg-control-primary-disabled-bg disabled:text-control-primary-disabled-text";

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
	const t = useT();
	const revisions = itemRevisions(item);
	if (revisions.length < 2) return null;
	const unreviewed = new Set(item.review?.unreviewedShas ?? []);
	return (
		<div data-testid="plan-revisions">
			<span className="px-4 tr-text-eyebrow text-text-subtle">{t("plan.revisions.title")}</span>
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
								title={t("plan.revisions.openCommit")}
								className="flex min-h-8 shrink-0 items-center gap-4 rounded-sm px-4 py-2 tr-code-text text-text-subtle hover:bg-control-bg-hovered hover:text-text-default"
							>
								<GitCommitHorizontal className="size-14" />
								{rev.sha.slice(0, 7)}
							</button>
							{stat ? <DiffStatBadge added={stat.added} removed={stat.removed} /> : null}
							{unreviewed.has(rev.sha) ? (
								<span className="tr-text-metadata text-feedback-warning">
									{t("plan.revisions.unreviewed")}
								</span>
							) : null}
							{index === revisions.length - 1 ? (
								<span className="tr-text-metadata text-text-subtle">
									{t("plan.revisions.current")}
								</span>
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
	reviewComments: ReviewComment[] | undefined;
	startDisabled: boolean;
	focusRequest: { id: string; tick: number } | null;
}) {
	const t = useT();
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
			<div className="flex items-start gap-8 rounded-sm p-4 transition-colors group-hover:bg-control-bg-hovered">
				<span
					className="flex min-h-24 shrink-0 items-center"
					title={
						reviewing
							? t("plan.item.checkingTitle")
							: changesRequested
								? t("plan.item.needsFix")
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
								title={expanded ? t("plan.item.hideDetails") : t("plan.item.showDetails")}
								className="flex min-w-0 flex-1 items-center gap-8 rounded-sm text-left"
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
								title={t("plan.item.reviewingTitle")}
								className="min-h-8 shrink-0 animate-pulse tr-text-metadata text-primary"
							>
								{t("plan.item.checking")}
							</span>
						) : changesRequested ? (
							<button
								type="button"
								data-testid="plan-item-changes-requested"
								title={t("plan.item.changesRequestedTitle")}
								onClick={onOpenReview}
								className="flex min-h-8 shrink-0 items-center gap-2 tr-text-metadata text-feedback-warning underline-offset-2 hover:underline"
							>
								<CircleAlert className="size-14" />
								{findings > 0
									? t("plan.item.needsFixCount", { count: findings })
									: t("plan.item.needsFix")}
							</button>
						) : needsReview ? (
							<button
								type="button"
								data-testid="plan-start-review"
								disabled={startDisabled}
								title={startDisabled ? t("plan.item.reviewBusy") : undefined}
								onClick={() => onStartReview(item.id)}
								className="flex h-24 shrink-0 items-center rounded-sm bg-control-primary-bg px-8 text-control-primary-text tr-text-action opacity-100 transition hover:bg-control-primary-bg-hovered focus-visible:opacity-100 disabled:bg-control-primary-disabled-bg disabled:text-control-primary-disabled-text [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100"
							>
								{t("plan.item.checkIt")}
							</button>
						) : reviewed ? (
							<span
								data-testid="plan-item-verified"
								title={t("plan.item.checkedTitle")}
								className="flex min-h-8 shrink-0 items-center gap-2 tr-text-metadata text-feedback-success"
							>
								<CircleCheck className="size-14" />
								{t("plan.item.checked")}
							</span>
						) : null}
					</div>
					{collapsible && (item.summary || item.verification || set) ? (
						<div
							data-testid="plan-item-meta"
							className="flex flex-col gap-2 tr-text-metadata text-text-subtle group-data-[expanded=true]:hidden"
						>
							{item.status === "done" && item.summary ? (
								<span data-testid="plan-item-summary-preview" className="flex items-start gap-8">
									<span className="size-14 shrink-0" />
									<Markdown
										text={item.summary}
										className={`min-w-0 flex-1 line-clamp-1 ${SUMMARY_PROSE}`}
									/>
								</span>
							) : null}
							{item.verification || set ? (
								<span className="flex items-center gap-8">
									<span className="size-14 shrink-0" />
									{item.verification ? (
										<VerificationGlyph verification={item.verification} />
									) : null}
									{set ? <span>{t("plan.fileCount", { count: fileCount })}</span> : null}
									{set?.kind === "commit" && counts ? (
										<span className="flex items-center gap-8 max-sm:hidden">
											<span className="tr-code-text">{set.sha.slice(0, 7)}</span>
											<DiffStatBadge added={counts.added} removed={counts.removed} />
										</span>
									) : null}
								</span>
							) : null}
						</div>
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
	"[&_h1]:mt-12 [&_h1]:mb-8 [&_h1]:tr-title-dialog [&_h1]:text-text-default",
	"[&_h2]:mt-12 [&_h2]:mb-8 [&_h2]:tr-title-dialog [&_h2]:text-text-default",
	"[&_h3]:mt-12 [&_h3]:mb-4 [&_h3]:tr-title-section [&_h3]:text-text-default",
	"[&_h4]:mt-8 [&_h4]:mb-4 [&_h4]:tr-title-section [&_h4]:text-text-default",
	"[&_p]:my-4 [&_strong]:text-text-default",
	"[&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2",
	"[&_ul]:my-4 [&_ul]:list-disc [&_ul]:pl-16 [&_ol]:my-4 [&_ol]:list-decimal [&_ol]:pl-16 [&_li]:my-2",
	"[&_li>ul]:my-2 [&_li>ol]:my-2 [&_li_p]:my-2",
	"[&_code]:rounded-xs [&_code]:bg-container-elevated-bg [&_code]:px-4 [&_code]:py-2 [&_code]:tr-code-text [&_code]:text-text-default",
	"[&_pre]:my-8 [&_pre]:overflow-x-auto [&_pre]:rounded-sm [&_pre]:border [&_pre]:border-border-default [&_pre]:bg-container-elevated-bg [&_pre]:p-8",
	"[&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:tr-code-text",
	"[&_blockquote]:my-8 [&_blockquote]:border-primary-muted [&_blockquote]:border-l-2 [&_blockquote]:pl-8 [&_blockquote]:text-text-muted",
	"[&_hr]:my-12 [&_hr]:h-px [&_hr]:border-0 [&_hr]:bg-border-default",
].join(" ");

function PlanSummary({ summary, stale = false }: { summary: string; stale?: boolean }) {
	const t = useT();
	return (
		<div className={`${PLAN_CARD_CLASS} flex flex-col gap-8`}>
			<div className="flex flex-wrap items-center gap-x-8 gap-y-2">
				<span className="tr-text-eyebrow text-text-subtle">{t("plan.summary.title")}</span>
				{stale ? (
					<span
						data-testid="plan-summary-stale"
						title={t("plan.summary.staleTitle")}
						className="flex items-center gap-4 tr-text-metadata text-text-muted"
					>
						<Loader2 className="size-14 shrink-0 animate-spin text-text-muted" />
						{t("plan.summary.updating")}
					</span>
				) : null}
			</div>
			<div data-testid="plan-overall-summary" className="max-h-[40vh] overflow-y-auto">
				<Markdown text={summary} className={`tr-text-ui ${SUMMARY_PROSE}`} />
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
	reviewComments: ReviewComment[] | undefined;
	startDisabled: boolean;
	focusRequest: { id: string; tick: number } | null;
}) {
	const t = useT();
	const { done, total } = groupProgress(group);
	const empty = group.todos.length === 0;
	return (
		<section className="mb-16" data-testid="plan-group" data-empty={empty || undefined}>
			<h2 className="mb-4 flex items-baseline gap-8 border-border-default border-b pb-4 tr-title-dialog text-text-default">
				<span className="min-w-0 flex-1 break-words">{group.title}</span>
				<span className="shrink-0 tr-text-eyebrow text-text-subtle">
					{empty ? t("plan.group.planning") : `${done}/${total}`}
				</span>
			</h2>
			{empty ? (
				<p
					data-testid="plan-group-planning"
					className="flex items-center gap-8 px-4 py-4 tr-text-metadata text-text-subtle"
				>
					<Loader2 className="size-14 shrink-0 animate-spin text-primary" />
					{t("plan.group.forming")}
				</p>
			) : null}
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
	const submitting = useRef(false);
	useEffect(() => {
		if (autoFocus) inputRef.current?.focus();
	}, [autoFocus]);
	const submit = async () => {
		const text = draft.trim();
		if (!text || submitting.current) return;
		submitting.current = true;
		const send = async () => {
			await onSubmit(text);
			setDraft("");
		};
		await send()
			.catch(() => {})
			.finally(() => {
				submitting.current = false;
			});
	};
	return (
		<div className="mt-8 flex items-start gap-8 rounded-sm border border-control-border-default bg-control-bg px-12 py-8 transition-colors focus-within:border-control-border-active">
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

function PlanInteractionCard({ pending }: { pending: PendingInteraction }) {
	const interaction = useToolInteraction(pending.toolCallId, pending.toolName);
	const Renderer = getToolRenderer(pending.toolName);
	return (
		<Renderer
			toolCallId={pending.toolCallId}
			toolName={pending.toolName}
			args={pending.args}
			result={pending.result}
			status={pending.status}
			streaming={pending.streaming}
			interaction={interaction}
		/>
	);
}

// Keep the session's live slot isolated from the heavy PlanPane.
function PlanSessionLive({ sessionId }: { workspaceId: string; sessionId: string }) {
	const t = useT();
	const runtime = useAppStore((s) => s.sessions[sessionId]);
	const [focusScope] = useState<object>(() => ({}));
	const actions = useMemo<ChatActions>(
		() => ({
			cancelAutomaticReveal: () => {},
			focusComposer: () => {},
			openSubagentTranscript: () => {},
			respondToTool: (toolCallId, response) =>
				getTransport()
					.request("session.respondToTool", { sessionId, toolCallId, response })
					.then(() => undefined),
			resultOpener: () => undefined,
			revealChatElement: () => {},
		}),
		[sessionId],
	);
	const interactionStates = useMemo(
		() =>
			runtime
				? deriveInteractionStates(runtime.turns, runtime.toolResponses, runtime.toolResults)
				: {},
		[runtime],
	);
	const pending = runtime ? pendingInteraction(runtime) : undefined;
	if (pending) {
		return (
			<ChatActionsContext.Provider value={actions}>
				<InteractionStatesContext.Provider
					value={{
						states: interactionStates,
						focusScope,
						awaitingToolCallId: awaitingToolCallIdOf(runtime?.hostState ?? null),
					}}
				>
					<div data-testid="plan-ask" className="mb-8">
						<PlanInteractionCard pending={pending} />
					</div>
				</InteractionStatesContext.Provider>
			</ChatActionsContext.Provider>
		);
	}
	const message = runtime ? lastAgentText(runtime) : undefined;
	if (!message) return null;
	return (
		<div data-testid="plan-agent-message" className="mb-8 flex items-start gap-8 px-4">
			<MessageSquare className="mt-2 size-14 shrink-0 text-text-muted" />
			<div className="min-w-0 flex-1">
				<div className="tr-text-eyebrow text-text-muted">{t("plan.session.agent")}</div>
				<div className="max-h-[12rem] overflow-y-auto">
					<Markdown text={message} className={`tr-text-metadata ${SUMMARY_PROSE}`} />
				</div>
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
	renderLive: () => ReactNode;
	onAdd: (title: string) => Promise<void>;
	onOpenChat: () => void;
	onSend: (text: string) => Promise<void> | void;
	renderGroup: (group: TodoGroupItem) => ReactNode;
	renderItem: (item: TodoItem) => ReactNode;
}) {
	const t = useT();
	const [adding, setAdding] = useState(false);
	const hasActive = activeGroups.length > 0 || activeLoose.length > 0;
	const hasPending = pendingGroups.length > 0 || pendingLoose.length > 0;
	const hasAny = hasActive || hasPending;
	const idleEmpty = glance === "waiting" && !hasAny && !allDone;
	return (
		<section data-testid="plan-now-executing" className={PLAN_CARD_CLASS}>
			<div className="mb-8 flex items-center gap-8">
				<CircleDot className="size-14 shrink-0 text-primary" />
				<h2 className="shrink-0 tr-title-dialog text-text-default">{t("plan.session.now")}</h2>
				{glance === "working" ? (
					<button
						type="button"
						data-testid="plan-now-status"
						data-glance="working"
						onClick={onOpenChat}
						title={t("plan.session.openChat")}
						className="flex min-w-0 items-center gap-4 tr-text-metadata text-text-subtle underline-offset-2 hover:text-text-default hover:underline"
					>
						<Loader2 className="size-14 shrink-0 animate-spin text-primary" />
						{t("plan.session.working")}
					</button>
				) : glance === "waiting_question" ? (
					<button
						type="button"
						data-testid="plan-now-status"
						data-glance="waiting_question"
						onClick={onOpenChat}
						title={t("plan.session.openChat")}
						className="flex min-w-0 items-center gap-4 tr-text-metadata text-primary underline-offset-2 hover:underline"
					>
						<MessageCircleQuestion className="size-14 shrink-0" />
						{t("plan.session.question")}
					</button>
				) : null}
				<button
					type="button"
					data-testid="plan-add-task"
					onClick={() => setAdding((v) => !v)}
					title={t("plan.session.addTaskTitle")}
					className="ml-auto flex h-24 shrink-0 items-center gap-4 rounded-sm px-8 tr-text-action text-text-muted transition-colors hover:bg-control-bg-hovered hover:text-text-default"
				>
					<Plus className="size-14" />
					{t("plan.session.task")}
				</button>
			</div>
			{renderLive()}
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
					{hasActive ? <SectionLabel label={t("plan.session.upNext")} /> : null}
					{pendingGroups.map(renderGroup)}
					{pendingLoose.length > 0 ? (
						<ul className="flex flex-col">{pendingLoose.map(renderItem)}</ul>
					) : null}
				</>
			) : null}
			{idleEmpty && !adding ? (
				<button
					type="button"
					data-testid="plan-now-idle"
					data-glance="waiting"
					onClick={() => setAdding(true)}
					title={t("plan.session.addTask")}
					className="group flex w-full items-center gap-8 rounded-sm px-4 py-2 text-left tr-text-ui text-text-subtle transition-colors hover:bg-control-bg-hovered hover:text-text-default"
				>
					<span className="min-w-0 flex-1">{t("plan.session.empty")}</span>
					<span className="flex shrink-0 items-center gap-4 text-text-muted opacity-0 transition-opacity group-hover:opacity-100">
						<Plus className="size-14" />
						{t("plan.session.addTask")}
					</span>
				</button>
			) : null}
			<div hidden={glance === "waiting_question" || idleEmpty}>
				<PlanComposer
					icon={MessageSquare}
					testId="plan-session-chat"
					placeholder={
						glance === "working"
							? t("plan.session.steerPlaceholder")
							: t("plan.session.messagePlaceholder")
					}
					onSubmit={onSend}
				/>
			</div>
			{adding ? (
				<PlanComposer
					icon={Plus}
					testId="plan-add-input"
					placeholder={t("plan.session.addPlaceholder")}
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
	const t = useT();
	const plan = useChatTodos(workspaceId, sessionId);
	const title = useAppStore((s) => selectChatTitle(t, s, workspaceId, sessionId));
	const chatName = useAppStore((s) => selectChatName(s, workspaceId, sessionId));
	const pushToast = useAppStore((s) => s.pushToast);
	const requestToolView = useAppStore((s) => s.requestToolView);
	const workspace = useAppStore((s) => selectWorkspaceById(s, workspaceId));
	const glance = useAppStore((s): PlanGlance => {
		const rt = s.sessions[sessionId];
		return rt ? sessionGlance(rt) : "waiting";
	});
	const connection = useAppStore((s) => s.status);
	const hasRuntime = useAppStore((s) => s.sessions[sessionId] !== undefined);
	useEffect(() => {
		if (connection !== "connected" || hasRuntime) return;
		hydrateSessionRuntime(workspaceId, sessionId).catch(() => {});
	}, [connection, hasRuntime, workspaceId, sessionId]);
	const protocolVersion = useAppStore((s) => s.protocolVersion);
	const workspaceSettlingSupported = useAppStore((s) => s.workspaceSettlingSupported);
	const canReview = supportsPlanReview(protocolVersion);
	const {
		review: branchReview,
		url: branchReviewUrl,
		status: branchStatus,
		noteOpenReview,
		refreshBranchStatus,
	} = useBranchStatus(workspace, connection);
	const branchReviewWithUrl =
		branchReview && branchReviewUrl ? { ...branchReview, url: branchReviewUrl } : branchReview;
	const resolvedBranchReview = resolveBranchReview(
		branchReviewWithUrl,
		workspace?.review,
		workspaceSettlingSupported,
	);
	const openReview =
		resolvedBranchReview.review && isOpenBranchReview(resolvedBranchReview.review)
			? resolvedBranchReview.review
			: null;
	const openReviewUrl = openReview?.url;
	const ship = useShipRunner({
		workspace,
		sessionId,
		title: chatName,
		bodySource: "plan",
		openReview,
		status: branchStatus,
		analyticsSource: "plan_page",
		noteOpenReview,
		refresh: refreshBranchStatus,
	});
	const prBusy = ship.busy;
	const [focusRequest, setFocusRequest] = useState<{ id: string; tick: number } | null>(null);
	const agentComments = useAppStore((s) => selectAgentReviewCommentCount(s, workspaceId));
	const reviewComments = useAppStore((s) => s.reviewsByWorkspace[workspaceId]?.comments);

	if (plan.data === null) {
		if (plan.failed) {
			return (
				<div className="flex h-full items-center justify-center text-text-subtle tr-text-ui">
					{t("plan.pane.loadFailed")}
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
	const diverged = (openReview?.behindCommits ?? 0) > 0;
	const branch = workspace?.branch ?? "";
	const { integrateCommand, copyIntegrateCommand, openPr: openPrFlow } = ship;
	const startReview = async (id: string): Promise<void> =>
		plan.startReview(id).then(
			() => {
				pushToast({
					variant: "success",
					title: t("plan.review.startedTitle"),
					message: t("plan.review.startedMessage"),
				});
			},
			(err) => {
				pushToast({
					variant: "error",
					title: t("plan.review.startFailed"),
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
								title: t("plan.checkAll.runningTitle"),
								message: t("plan.checkAll.runningMessage"),
							}
						: total > 0
							? {
									variant: "success",
									title: t("plan.checkAll.startedTitle"),
									message: t("plan.checkAll.startedMessage", { count: total }),
								}
							: {
									variant: "info",
									title: t("plan.checkAll.nothingTitle"),
									message: t("plan.checkAll.nothingMessage"),
								},
				);
			},
			(err) => {
				pushToast({
					variant: "error",
					title: t("plan.checkAll.startFailed"),
					message: errorText(err),
				});
			},
		);
	const copyMarkdown = () => {
		void navigator.clipboard
			.writeText(exportMarkdown())
			.then(() =>
				pushToast({
					variant: "success",
					title: t("plan.copied.title"),
					message: t("plan.copied.message"),
				}),
			)
			.catch(() =>
				pushToast({
					variant: "error",
					title: t("plan.copyFailed.title"),
					message: t("plan.copyFailed.message"),
				}),
			);
	};
	const exportMarkdown = () => planToMarkdown(t, data, title);
	const renderGroup = (group: TodoGroupItem): ReactNode => (
		<GroupSection
			key={group.id}
			group={group}
			workspaceId={workspaceId}
			sessionId={sessionId}
			onOpenCommit={onOpenCommit}
			onStartReview={startReview}
			onOpenReview={onOpenReview}
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
			{ship.dialogs}
			<div className="mx-auto max-w-[52rem] px-16 py-16">
				<header className="mb-16 flex items-center gap-12">
					<div className="min-w-0 flex-1">
						<h1 className="truncate tr-heading-sm text-text-default">
							{t("plan.header.title", { title })}
						</h1>
						<div
							data-testid="plan-progress"
							className="flex flex-wrap items-center gap-4 tr-text-metadata text-text-subtle"
						>
							<StageGlyph state={stages.build} />
							<span>{t("plan.header.done", { done, total })}</span>
							{reviewables.length > 0 ? (
								<>
									<ChevronRight className="size-12 shrink-0 text-text-muted" />
									<span data-testid="plan-review-progress" className="flex items-center gap-4">
										<StageGlyph state={stages.review} />
										{t("plan.header.reviewed", {
											reviewed: reviewedCount,
											total: reviewables.length,
										})}
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
								{openReview ? openReviewLabel(openReview) : t("plan.header.pr")}
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
							title={t("plan.header.commentsTitle")}
							className="flex h-32 shrink-0 items-center gap-4 rounded-sm px-8 tr-text-ui text-text-muted transition-colors hover:bg-control-bg-hovered hover:text-text-default"
						>
							<MessageSquare className="size-14" />
							{t("plan.header.comments", { count: agentComments })}
						</button>
					) : null}
					{openReview ? (
						openReviewUrl ? (
							<a
								data-testid="plan-pr-chip"
								href={openReviewUrl}
								target="_blank"
								rel="noopener noreferrer"
								className="flex h-32 shrink-0 items-center rounded-sm px-8 tr-text-ui text-text-muted transition-colors hover:bg-control-bg-hovered hover:text-text-default"
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
						data-diverged={openReview && diverged ? "" : undefined}
						disabled={prBusy || sameBranch || (!!openReview && diverged && !integrateCommand)}
						onClick={openReview && diverged ? copyIntegrateCommand : () => void openPrFlow(false)}
						title={
							sameBranch
								? t("plan.openPr.sameBranch")
								: openReview && diverged
									? integrateCommand
										? t("plan.openPr.divergedCopy", { command: integrateCommand })
										: t("plan.openPr.divergedManual", { branch })
									: openReview
										? t("plan.openPr.pushTitle")
										: t("plan.openPr.openTitle")
						}
						className={`flex h-32 shrink-0 items-center gap-4 rounded-sm px-8 tr-text-ui transition-colors ${
							(planReady && !openReview) || unpushed > 0 || (openReview && diverged)
								? "bg-control-primary-bg text-control-primary-text hover:bg-control-primary-bg-hovered disabled:bg-control-primary-disabled-bg disabled:text-control-primary-disabled-text"
								: "text-text-muted hover:bg-control-bg-hovered hover:text-text-default disabled:text-control-disabled-text"
						}`}
					>
						{prBusy ? (
							<Loader2 className="size-14 animate-spin" />
						) : (
							<GitPullRequestArrow className="size-14" />
						)}
						{ship.submitting
							? t("plan.openPr.pushing")
							: openReview
								? diverged
									? t("plan.openPr.diverged")
									: unpushed > 0
										? t("plan.openPr.pushUpdatesCount", { count: unpushed })
										: t("plan.openPr.pushUpdates")
								: t("plan.openPr.open")}
					</button>
					<DropdownMenu>
						<DropdownMenuTrigger
							data-testid="plan-menu"
							aria-label={t("plan.menu.label")}
							className="flex size-32 shrink-0 items-center justify-center rounded-sm text-text-muted outline-none hover:bg-control-bg-hovered hover:text-text-default focus-visible:ring-2 focus-visible:ring-primary data-[state=open]:bg-control-bg-hovered"
						>
							<MoreVertical className="size-16" />
						</DropdownMenuTrigger>
						<DropdownMenuContent align="end" data-testid="plan-menu-content">
							<DropdownMenuItem data-testid="plan-copy-markdown" onSelect={() => copyMarkdown()}>
								<Copy />
								{t("common.copy")}
							</DropdownMenuItem>
							<DropdownMenuItem
								data-testid="plan-save-markdown"
								onSelect={() => downloadMarkdown(exportMarkdown(), title)}
							>
								<Download />
								{t("plan.menu.saveMarkdown")}
							</DropdownMenuItem>
							{!openReview ? (
								<DropdownMenuItem
									data-testid="plan-open-draft-pr"
									disabled={prBusy || sameBranch}
									onSelect={() => void openPrFlow(true)}
								>
									<GitPullRequestArrow />
									{t("plan.menu.openDraftPr")}
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
										{unsettledReviewables.length > 0
											? t("plan.menu.checkAllCount", { count: unsettledReviewables.length })
											: t("plan.menu.checkAll")}
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
							{t("plan.next.fix", { count: flagged.length })}
						</span>
						<button
							type="button"
							data-testid="plan-next-action-go"
							onClick={() => flagged[0] && jumpToItem(flagged[0].id)}
							className={NEXT_ACTION_BUTTON_CLASS}
						>
							{t("plan.next.showStep")}
						</button>
					</div>
				) : unsettledReviewables.length > 0 ? (
					<div data-testid="plan-next-action" data-kind="review" className={NEXT_ACTION_CLASS}>
						<ListChecks className="size-16 shrink-0 text-primary" />
						<span className="min-w-0 flex-1 tr-text-ui text-text-default">
							{t("plan.next.review", { count: unsettledReviewables.length })}
						</span>
						<button
							type="button"
							data-testid="plan-next-action-go"
							disabled={reviewingAny || !canReview}
							onClick={() => void reviewAll()}
							className={NEXT_ACTION_BUTTON_CLASS}
						>
							{t("plan.menu.checkAll")}
						</button>
					</div>
				) : openReview && diverged ? (
					<div data-testid="plan-next-action" data-kind="diverged" className={NEXT_ACTION_CLASS}>
						<CircleAlert className="size-16 shrink-0 text-feedback-warning" />
						<div className="flex min-w-0 flex-1 flex-col gap-2">
							<span className="tr-text-ui text-text-default">
								{integrateCommand
									? t("plan.next.divergedRun", { review: openReviewLabel(openReview) })
									: t("plan.next.divergedManual", { review: openReviewLabel(openReview), branch })}
							</span>
							{integrateCommand ? (
								<code
									data-testid="plan-integrate-command"
									className="truncate rounded-sm bg-container-elevated-bg px-4 py-2 tr-code-text text-text-default"
								>
									{integrateCommand}
								</code>
							) : null}
						</div>
						{integrateCommand ? (
							<button
								type="button"
								data-testid="plan-next-action-go"
								onClick={copyIntegrateCommand}
								className={NEXT_ACTION_BUTTON_CLASS}
							>
								{t("plan.next.copyCommand")}
							</button>
						) : null}
					</div>
				) : openReview && unpushed > 0 ? (
					<div data-testid="plan-next-action" data-kind="push" className={NEXT_ACTION_CLASS}>
						<GitPullRequestArrow className="size-16 shrink-0 text-primary" />
						<span className="min-w-0 flex-1 tr-text-ui text-text-default">
							{t("plan.next.unpushed", { count: unpushed, review: openReviewLabel(openReview) })}
						</span>
						<button
							type="button"
							data-testid="plan-next-action-go"
							disabled={prBusy}
							onClick={() => void openPrFlow(false)}
							className={NEXT_ACTION_BUTTON_CLASS}
						>
							{t("plan.openPr.pushUpdates")}
						</button>
					</div>
				) : planReady && !openReview && !sameBranch ? (
					<div data-testid="plan-next-action" data-kind="ship" className={NEXT_ACTION_CLASS}>
						<GitPullRequestArrow className="size-16 shrink-0 text-feedback-success" />
						<span className="min-w-0 flex-1 tr-text-ui text-text-default">
							{t("plan.next.ship")}
						</span>
						<button
							type="button"
							data-testid="plan-next-action-go"
							disabled={prBusy}
							onClick={() => void openPrFlow(false)}
							className={NEXT_ACTION_BUTTON_CLASS}
						>
							{t("plan.openPr.open")}
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
					renderLive={() => <PlanSessionLive workspaceId={workspaceId} sessionId={sessionId} />}
					onAdd={(title) => plan.add(title, "page")}
					onOpenChat={() => {
						void openChatInTab(workspaceId, sessionId);
					}}
					onSend={async (text) => {
						const send = async () => {
							await hydrateSessionRuntime(workspaceId, sessionId);
							const store = useAppStore.getState();
							const runtime = store.sessions[sessionId];
							if (!runtime) throw new Error(t("plan.session.chatLoadFailed"));
							if (runtime.isStreaming) {
								await getTransport().request("session.steer", { sessionId, text });
							} else {
								store.appendUserMessage(sessionId, text);
								void getTransport()
									.request("session.prompt", { sessionId, text })
									.catch((err) =>
										useAppStore.getState().appendErrorTurn(sessionId, errorText(err)),
									);
							}
						};
						await send().catch((err: unknown) => {
							pushToast({
								variant: "error",
								title: t("plan.session.sendFailed"),
								message: errorText(err),
							});
							throw err;
						});
					}}
					renderGroup={renderGroup}
					renderItem={renderItem}
				/>
				{sections.doneGroups.length > 0 || sections.doneLoose.length > 0 ? (
					<PlanCardSection
						testId="plan-done-section"
						label={t("chat.todo.status.done")}
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
							<span className="min-w-0 flex-1 truncate">{t("plan.adopted.title")}</span>
							<span className="shrink-0 tr-text-eyebrow text-text-subtle">
								{t("plan.adopted.count", { count: adopted.length })}
							</span>
						</h2>
						<p className="mb-4 px-4 tr-text-metadata text-text-subtle">
							{t("plan.adopted.description")}
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
							<span className="min-w-0 flex-1 truncate">{t("plan.unattributed.title")}</span>
							<span className="shrink-0 tr-text-eyebrow text-text-subtle">
								{t("plan.fileCount", { count: data.unattributed.length })}
							</span>
						</h2>
						<p className="mb-4 px-4 tr-text-metadata text-text-subtle">
							{t("plan.unattributed.description")}
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
