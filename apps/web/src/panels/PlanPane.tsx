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
	RiChat1Line as MessageSquare,
	RiMore2Line as MoreVertical,
} from "@remixicon/react";
import type { ReviewComment, TodoGroupItem, TodoItem } from "@thinkrail/contracts";
import { useEffect, useRef, useState } from "react";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { VerificationBadge, VerificationGlyph } from "../chat/planKit";
import { planToMarkdown } from "../chat/planMarkdown";
import {
	changeSetCounts,
	changeSetStat,
	flatItems,
	groupProgress,
	itemChangeSet,
	itemOpenFindings,
	itemRevisions,
	planCompletionSummary,
	planSections,
	planSummary,
	reviewableItems,
	reviewChangesRequested,
	reviewSettled,
} from "../chat/planView";
import { StatusIcon } from "../chat/TodoList";
import { useChatTodos } from "../chat/useChatTodos";
import { SkeletonRows } from "../components/Skeleton";
import { IconTooltip } from "../components/ui/tooltip";
import {
	selectAgentReviewCommentCount,
	selectChatTitle,
	selectWorkspaceById,
	useAppStore,
} from "../store";
import { errorText, getTransport, wsErrorCode } from "../transport";
import { DiffStatBadge } from "./DiffStatBadge";
import { openChatInTab } from "./openChat";
import { openDiffInTab } from "./openTabs";
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

const NEXT_ACTION_CLASS =
	"mb-16 flex items-center gap-8 rounded-[var(--radius-md)] bg-container-elevated-bg px-12 py-8";
const NEXT_ACTION_BUTTON_CLASS =
	"shrink-0 rounded-[var(--radius-sm)] bg-primary px-8 py-4 tr-text-ui text-text-on-primary hover:opacity-90 disabled:opacity-50";

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
	reviewComments,
	reviewerSessionId,
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
	reviewerSessionId?: string | undefined;
	startDisabled: boolean;
	focusRequest: { id: string; tick: number } | null;
}) {
	const reviewed = reviewSettled(item);
	const reviewing = item.review?.reviewing === true;
	const changesRequested = reviewChangesRequested(item) && !reviewing;
	const needsReview = item.review !== undefined && !reviewed;
	const findings = changesRequested ? itemOpenFindings(item, reviewComments, sessionId) : 0;
	const set = itemChangeSet(item);
	const counts = set ? changeSetCounts(set) : null;
	const fileCount = counts?.count ?? 0;
	const feedback = changesRequested ? item.review?.feedback : undefined;
	const hasDetails = Boolean(
		item.note || item.summary || item.verification || feedback || set !== null,
	);
	const collapsible = item.status === "done" && hasDetails;
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
			<div className="flex items-start gap-8 rounded-[var(--radius-sm)] transition-colors group-hover:bg-control-bg-hovered">
				<span
					className="flex min-h-8 shrink-0 items-center"
					title={
						reviewing
							? "Reviewing — the reviewer agent is reading this step"
							: changesRequested
								? "Changes requested"
								: reviewed
									? "Verified"
									: undefined
					}
				>
					<StatusIcon
						status={item.status}
						glance="working"
						reviewed={reviewed}
						reviewing={reviewing}
						changesRequested={changesRequested}
					/>
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
								className="flex min-w-0 flex-1 items-center gap-8 rounded-[var(--radius-sm)] px-4 py-2 text-left"
							>
								<ChevronRight className="size-14 shrink-0 text-text-muted transition-transform group-data-[expanded=true]:rotate-90" />
								<span className="min-w-0 flex-1 truncate tr-title-section text-text-default">
									{item.title}
								</span>
							</button>
						) : (
							<span className="flex min-w-0 flex-1 items-center gap-8 px-4">
								<span className="size-14 shrink-0" />
								<span className="min-w-0 flex-1 truncate tr-title-section text-text-default">
									{item.title}
								</span>
							</span>
						)}
						{reviewing ? (
							<button
								type="button"
								data-testid="plan-item-reviewing"
								title="Open the reviewer's chat to watch the process"
								onClick={() =>
									reviewerSessionId && void openChatInTab(workspaceId, reviewerSessionId)
								}
								className="min-h-8 shrink-0 tr-text-metadata text-primary underline-offset-2 hover:underline"
							>
								Reviewing…
							</button>
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
						) : null}
					</div>
					{collapsible && (item.verification || set) ? (
						<span className="flex items-center gap-8 px-4 tr-text-metadata text-text-subtle group-data-[expanded=true]:hidden">
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
					className={`mt-2 ml-8 flex-col gap-2 border-border-default border-l pl-12 ${detailsClass}`}
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
						<div data-testid="plan-item-summary" className="tr-text-metadata text-text-muted">
							{item.summary}
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

function OverallSummary({ text }: { text: string }) {
	const [open, setOpen] = useState(false);
	const clampable = text.length > 240;
	return (
		<div className="mb-16 rounded-[var(--radius-md)] bg-container-elevated-bg p-12">
			<div className="mb-2 tr-text-eyebrow text-text-subtle">Summary</div>
			<p
				data-testid="plan-overall-summary"
				className={`tr-text-ui text-text-muted ${clampable && !open ? "line-clamp-3" : ""}`}
			>
				{text}
			</p>
			{clampable ? (
				<button
					type="button"
					data-testid="plan-overall-summary-toggle"
					onClick={() => setOpen((v) => !v)}
					className="mt-4 tr-text-metadata text-text-subtle underline-offset-2 hover:text-text-default hover:underline"
				>
					{open ? "Show less" : "Show more"}
				</button>
			) : null}
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
	reviewerSessionId,
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
	reviewerSessionId?: string | undefined;
	startDisabled: boolean;
	focusRequest: { id: string; tick: number } | null;
}) {
	const { done, total } = groupProgress(group);
	return (
		<section className="mb-16" data-testid="plan-group">
			<h2 className="mb-4 flex items-baseline gap-8 border-border-default border-b pb-4 tr-title-compact text-text-default">
				<span className="min-w-0 flex-1 truncate">{group.title}</span>
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
						reviewComments={reviewComments}
						reviewerSessionId={reviewerSessionId}
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
	const connection = useAppStore((s) => s.status);
	const hostPlatform = useAppStore((s) => s.hostPlatform);
	const {
		review: openReview,
		url: openReviewUrl,
		noteOpenReview,
	} = useOpenBranchReview(workspace, connection);
	const [prBusy, setPrBusy] = useState(false);
	const [prSetup, setPrSetup] = useState<PrSetupState | null>(null);
	const [prCompose, setPrCompose] = useState<PrComposeState | null>(null);
	const lastPrSubmit = useRef<{
		draft: boolean;
		title: string;
		body: string;
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
		return (
			<div className="h-full p-md">
				<SkeletonRows rows={8} />
			</div>
		);
	}
	const data = plan.data;
	const { done, total } = planSummary(data);
	const sections = planSections(data);
	const groups = [...sections.activeGroups, ...sections.pendingGroups, ...sections.doneGroups];
	const loose = [...sections.activeLoose, ...sections.pendingLoose, ...sections.doneLoose];
	const empty = groups.length === 0 && loose.length === 0;
	const reviewables = reviewableItems(data);
	const unsettledReviewables = reviewables.filter((t) => !reviewSettled(t));
	const reviewedCount = reviewables.length - unsettledReviewables.length;
	const overallSummary = planCompletionSummary(data);
	const onOpenCommit = (sha: string) => plan.openChanges({ sha });
	const onOpenReview = () => requestToolView(workspaceId, "review");
	const reviewingAny = reviewables.some((t) => t.review?.reviewing === true);
	const planReady = total > 0 && done === total && unsettledReviewables.length === 0;
	const sameBranch = Boolean(
		workspace && workspace.branch === workspace.baseBranch.replace(/^origin\//, ""),
	);
	const allItems = flatItems(data);
	const commitCount = allItems.reduce((n, t) => n + itemRevisions(t).length, 0);
	const flagged = allItems.filter((t) => reviewChangesRequested(t) && t.review?.reviewing !== true);
	const jumpToItem = (id: string) => {
		setFocusRequest((prev) => ({ id, tick: (prev?.tick ?? 0) + 1 }));
		document
			.getElementById(`plan-item-${id}`)
			?.scrollIntoView({ behavior: "smooth", block: "center" });
	};
	const buildDone = total > 0 && done === total;
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
		const edited = lastPrSubmit.current;
		if (edited && edited.draft === draft) {
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
	const submitPr = async (
		draft: boolean,
		prTitle: string,
		prBody: string,
		titleEdited: boolean,
	): Promise<void> => {
		lastPrSubmit.current = { draft, title: prTitle, body: prBody, titleEdited };
		setPrBusy(true);
		try {
			const result = await getTransport().request(
				"pr.open",
				{
					workspaceId,
					sessionId,
					title: prTitle,
					...(titleEdited ? { titleEdited: true } : {}),
					body: prBody,
					...(draft ? { draft: true } : {}),
				},
				{ timeoutMs: 180_000 },
			);
			setPrCompose(null);
			if (result.review) noteOpenReview(result.review, result.url);
			else if (openReview?.unpushedCommits)
				noteOpenReview({ kind: openReview.kind, number: openReview.number }, openReviewUrl);
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
		if (last) void submitPr(last.draft, last.title, last.body, last.titleEdited);
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

	return (
		<div data-testid="plan-pane" className="h-full overflow-auto bg-container-content-bg">
			<PrComposeDialog
				state={prCompose}
				updating={Boolean(openReview)}
				busy={prBusy}
				onClose={() => {
					setPrCompose(null);
					lastPrSubmit.current = null;
				}}
				onSubmit={(prTitle, prBody, titleEdited) => {
					if (prCompose) void submitPr(prCompose.draft, prTitle, prBody, titleEdited);
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
						<h1 className="truncate tr-title-section text-text-default">Plan · {title}</h1>
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
										{workspace.branch} ← {workspace.baseBranch}
									</span>
								</span>
								{commitCount > 0 ? (
									<span className="shrink-0">
										{commitCount} {commitCount === 1 ? "commit" : "commits"}
									</span>
								) : null}
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
							className="flex shrink-0 items-center gap-4 rounded-[var(--radius-sm)] px-8 py-4 tr-text-ui text-text-muted hover:bg-control-bg-hovered hover:text-text-default"
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
								className="shrink-0 rounded-[var(--radius-sm)] px-8 py-4 tr-text-ui text-text-muted hover:bg-control-bg-hovered hover:text-text-default"
							>
								{openReviewLabel(openReview)}
							</a>
						) : (
							<span
								data-testid="plan-pr-chip"
								className="shrink-0 px-8 py-4 tr-text-ui text-text-muted"
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
						className={`flex shrink-0 items-center gap-4 rounded-[var(--radius-sm)] px-8 py-4 tr-text-ui disabled:opacity-50 ${
							(planReady && !openReview) || unpushed > 0
								? "bg-primary text-text-on-primary hover:opacity-90"
								: "text-text-muted hover:bg-control-bg-hovered hover:text-text-default"
						}`}
					>
						{prBusy ? (
							<Loader2 className="size-14 animate-spin" />
						) : (
							<GitPullRequestArrow className="size-14" />
						)}
						{prBusy && prCompose
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
										disabled={unsettledReviewables.length === 0 || reviewingAny}
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
							disabled={reviewingAny}
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
				{overallSummary ? <OverallSummary text={overallSummary} /> : null}
				{empty ? (
					<p className="text-text-subtle tr-text-ui">
						No items yet — the agent adds its plan here.
					</p>
				) : (
					<>
						{groups.map((group) => (
							<GroupSection
								key={group.id}
								group={group}
								workspaceId={workspaceId}
								sessionId={sessionId}
								onOpenCommit={onOpenCommit}
								onStartReview={startReview}
								onOpenReview={onOpenReview}
								reviewComments={reviewComments}
								reviewerSessionId={data.reviewerSessionId}
								startDisabled={reviewingAny}
								focusRequest={focusRequest}
							/>
						))}
						{loose.length > 0 ? (
							<section className="mb-16" data-testid="plan-loose">
								{groups.length > 0 ? (
									<h2 className="mb-4 border-border-default border-b pb-4 tr-title-compact text-text-default">
										Other
									</h2>
								) : null}
								<ul className="flex flex-col">
									{loose.map((item) => (
										<ItemBlock
											key={item.id}
											item={item}
											workspaceId={workspaceId}
											sessionId={sessionId}
											onOpenCommit={onOpenCommit}
											onStartReview={startReview}
											onOpenReview={onOpenReview}
											reviewComments={reviewComments}
											reviewerSessionId={data.reviewerSessionId}
											startDisabled={reviewingAny}
											focusRequest={focusRequest}
										/>
									))}
								</ul>
							</section>
						) : null}
					</>
				)}
				{data.unattributed && data.unattributed.length > 0 ? (
					<section className="mb-16" data-testid="plan-unattributed">
						<h2 className="mb-4 flex items-baseline gap-8 border-border-default border-b pb-4 tr-title-compact text-text-default">
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
