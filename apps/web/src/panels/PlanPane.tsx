import type { TodoGroupItem, TodoItem } from "@thinkrail/contracts";
import {
	ChevronDown,
	ChevronRight,
	Copy,
	Download,
	GitCommitHorizontal,
	LoaderCircle,
} from "lucide-react";
import { useState } from "react";
import { VerificationBadge } from "../chat/planKit";
import { planToMarkdown } from "../chat/planMarkdown";
import {
	changeSetStat,
	groupProgress,
	itemChangeSet,
	planCompletionSummary,
	planSections,
	planSummary,
	reviewProgress,
	reviewSettled,
} from "../chat/planView";
import { StatusIcon } from "../chat/TodoList";
import { useChatTodos } from "../chat/useChatTodos";
import { cn } from "../lib";
import { selectChatTitle, useAppStore } from "../store";
import { errorText } from "../transport";
import { DiffStatBadge } from "./DiffStatBadge";
import { openDiffInTab } from "./openTabs";
import { PlanReviewList, ReviewActions } from "./PlanReview";
import { FileRow } from "./planFileRow";

// The chat plan's live review-map page — a center `plan` tab (see `store`'s `PlanTab`): the session's
// TODO plan rendered document-scale, each done item unfolding into the change set its work produced.
// Live by construction: it reads through the same `useChatTodos` hook as the plan popup (refetch off
// `pi.event`), so it can never show a stale snapshot the way the old compiled-markdown doc did.
// Navigation is direct handlers, not link-scheme hacks: a file row opens its Monaco diff tab (the item's
// `commit:{sha}` scope — the durable done-time diff — or the live branch scope for the path-list
// fallback), the sha chip points the Changes panel at the commit. Markdown is this page's *export*
// (`planMarkdown` → copy / save-as-.md), never its source.

/**
 * A done item's change set as a **collapsible disclosure**, collapsed by default so a long plan stays
 * compact. The chevron/`N files` summary toggles the file rows; the sha chip stays a separate button
 * that routes the Changes panel and never toggles the disclosure (and vice versa). **Review happens
 * right here, next to the changes**: expanding an unsettled reviewable item reveals a `Start review`
 * button which fires the AGENT review (`todo.startReview` — the plan's reviewer chat reads the diff,
 * files findings as review comments, and settles the item with its verdict) and OPENS the step's
 * changes — the Changes panel at the commit's scope (or the first fallback path's live diff) — so the
 * review is watchable. While the verdict is pending the row shows a `Reviewing…` pulse; the manual
 * verdict pair (`ReviewActions`) stays available under it as the human override. Approving settles the
 * item (circled Verified glyph) and every affordance disappears.
 */
function ChangeSetBlock({
	item,
	workspaceId,
	onOpenCommit,
	onApprove,
	onAskFix,
	onStartReview,
}: {
	item: TodoItem;
	workspaceId: string;
	onOpenCommit: (sha: string) => void;
	onApprove: (id: string) => Promise<void>;
	onAskFix: (id: string, feedback: string) => Promise<void>;
	onStartReview: (id: string) => Promise<void>;
}) {
	const [expanded, setExpanded] = useState(false);
	const [manual, setManual] = useState(false);
	const set = itemChangeSet(item);
	if (!set) return null;
	const Chevron = expanded ? ChevronDown : ChevronRight;
	const stat = set.kind === "commit" ? changeSetStat(set.files) : null;
	const count = set.kind === "paths" ? set.paths.length : (stat?.count ?? 0);
	const needsReview = item.review !== undefined && !reviewSettled(item);
	const reviewing = item.review?.reviewing === true;
	return (
		<div
			className="mt-xs"
			data-testid="plan-change-set"
			data-kind={set.kind}
			data-expanded={expanded}
		>
			<div className="flex items-center gap-sm px-xs">
				<button
					type="button"
					data-testid="plan-change-set-toggle"
					aria-expanded={expanded}
					onClick={() => setExpanded((v) => !v)}
					title={expanded ? "Hide changed files" : "Show changed files"}
					className="flex min-w-0 items-center gap-xs rounded-[var(--radius-sm)] px-xs py-2xs text-left hover:bg-control-bg-hovered"
				>
					<Chevron className="size-3.5 shrink-0 text-text-muted" />
					<span className="shrink-0 tr-text-metadata text-text-subtle">
						{count} {count === 1 ? "file" : "files"}
					</span>
				</button>
				{set.kind === "commit" ? (
					<>
						<button
							type="button"
							data-testid="plan-commit-chip"
							onClick={() => onOpenCommit(set.sha)}
							title="Open this step's commit in the Changes panel"
							className="flex shrink-0 items-center gap-xs rounded-[var(--radius-sm)] px-xs py-2xs tr-code-text text-text-subtle hover:bg-control-bg-hovered hover:text-text-default"
						>
							<GitCommitHorizontal className="size-3.5" />
							{set.sha.slice(0, 7)}
						</button>
						<DiffStatBadge added={stat?.added ?? 0} removed={stat?.removed ?? 0} />
					</>
				) : null}
				{expanded && reviewing ? (
					<span
						data-testid="plan-reviewing"
						className="ml-auto flex shrink-0 items-center gap-xs tr-text-metadata text-primary"
						title="The reviewer agent is reading this step's changes"
					>
						<LoaderCircle className="size-3.5 animate-spin" /> Reviewing…
					</span>
				) : null}
				{expanded && needsReview && !reviewing ? (
					<span className="ml-auto flex shrink-0 items-center gap-xs">
						<button
							type="button"
							data-testid="plan-start-review"
							onClick={() =>
								// Fire the AGENT review — and stay right here: the row pulses Reviewing…, findings
								// land in the Review tab. NO navigation (reviewer-flagged UX). A failed start must
								// be VISIBLE — the toast is the caller's only signal (the detached path's notice
								// lands in the reviewer chat nobody has open).
								onStartReview(item.id)
							}
							className="shrink-0 rounded-[var(--radius-sm)] border border-border-default px-sm py-2xs tr-text-ui text-text-default hover:bg-control-bg-hovered"
						>
							Start review
						</button>
						<button
							type="button"
							data-testid="plan-review-manually"
							onClick={() => setManual((v) => !v)}
							title="Judge it yourself — Approve / Ask to fix without the reviewer agent"
							className="shrink-0 rounded-[var(--radius-sm)] px-xs py-2xs tr-text-metadata text-text-muted hover:bg-control-bg-hovered hover:text-text-default"
						>
							manually
						</button>
					</span>
				) : null}
			</div>
			{expanded ? (
				set.kind === "paths" ? (
					// The no-commit fallback: live branch-scope diffs; no counts (they'd drift with the worktree).
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
			{expanded && manual && needsReview && !reviewing ? (
				<ReviewActions itemId={item.id} onApprove={onApprove} onAskFix={onAskFix} />
			) : null}
		</div>
	);
}

/** One plan item: status glyph + title + note, then its change set (done items that produced one).
 * A settled review upgrades the check to the circled **Verified** glyph (hover says so). */
function ItemBlock({
	item,
	workspaceId,
	onOpenCommit,
	onApprove,
	onAskFix,
	onStartReview,
}: {
	item: TodoItem;
	workspaceId: string;
	onOpenCommit: (sha: string) => void;
	onApprove: (id: string) => Promise<void>;
	onAskFix: (id: string, feedback: string) => Promise<void>;
	onStartReview: (id: string) => Promise<void>;
}) {
	const reviewed = reviewSettled(item);
	const reviewing = item.review?.reviewing === true;
	return (
		<li
			data-testid="plan-item"
			data-status={item.status}
			data-reviewed={reviewed}
			data-reviewing={reviewing}
			className="py-xs"
		>
			<div className="flex items-start gap-sm">
				<span
					className="mt-2xs"
					title={
						reviewing
							? "Reviewing — the reviewer agent is reading this step"
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
					/>
				</span>
				<div className="min-w-0 flex-1">
					<div
						className={
							item.status === "done" ? "tr-text-ui text-text-muted" : "tr-text-ui text-text-default"
						}
					>
						{item.title}
					</div>
					{item.note ? <div className="tr-text-metadata text-text-subtle">{item.note}</div> : null}
					{item.status === "done" && item.summary ? (
						<div data-testid="plan-item-summary" className="tr-text-ui text-text-muted">
							{item.summary}
						</div>
					) : null}
					{item.status === "done" && item.verification ? (
						<VerificationBadge verification={item.verification} />
					) : null}
					<ChangeSetBlock
						item={item}
						workspaceId={workspaceId}
						onOpenCommit={onOpenCommit}
						onApprove={onApprove}
						onAskFix={onAskFix}
						onStartReview={onStartReview}
					/>
				</div>
			</div>
		</li>
	);
}

function GroupSection({
	group,
	workspaceId,
	onOpenCommit,
	onApprove,
	onAskFix,
	onStartReview,
}: {
	group: TodoGroupItem;
	workspaceId: string;
	onOpenCommit: (sha: string) => void;
	onApprove: (id: string) => Promise<void>;
	onAskFix: (id: string, feedback: string) => Promise<void>;
	onStartReview: (id: string) => Promise<void>;
}) {
	const { done, total } = groupProgress(group);
	return (
		<section className="mb-lg" data-testid="plan-group">
			<h2 className="mb-xs flex items-baseline gap-sm border-border-default border-b pb-xs tr-title-compact text-text-default">
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
						onOpenCommit={onOpenCommit}
						onApprove={onApprove}
						onAskFix={onAskFix}
						onStartReview={onStartReview}
					/>
				))}
			</ul>
		</section>
	);
}

/** Trigger a browser download of the compiled markdown — the "we're a website" standard save. */
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
	const [mode, setMode] = useState<"plan" | "review">("plan");

	if (plan.data === null) {
		return (
			<div className="flex h-full items-center justify-center text-text-subtle tr-text-ui">
				{plan.failed ? "Couldn't load the plan." : "Loading…"}
			</div>
		);
	}
	const data = plan.data;
	const { done, total } = planSummary(data);
	const sections = planSections(data);
	const groups = [...sections.activeGroups, ...sections.pendingGroups, ...sections.doneGroups];
	const loose = [...sections.activeLoose, ...sections.pendingLoose, ...sections.doneLoose];
	const empty = groups.length === 0 && loose.length === 0;
	const review = reviewProgress(data);
	const overallSummary = planCompletionSummary(data);
	const onOpenCommit = (sha: string) => plan.openChanges({ sha });
	// Start review stays ON this page — the only signals are the row's Reviewing… pulse and a toast
	// (success AND failure: the detached error notice lands in a chat nobody has open).
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
	const exportMarkdown = () => planToMarkdown(data, title);

	return (
		<div data-testid="plan-pane" className="h-full overflow-auto bg-container-content-bg">
			<div className="mx-auto max-w-[52rem] px-lg py-lg">
				<header className="mb-lg flex items-center gap-md">
					<div className="min-w-0 flex-1">
						<h1 className="truncate tr-title-section text-text-default">Plan · {title}</h1>
						<div data-testid="plan-progress" className="tr-text-metadata text-text-subtle">
							{done}/{total} done
							{review.total > 0 ? (
								<span data-testid="plan-review-progress">
									{" · "}
									{review.reviewed}/{review.total} reviewed
								</span>
							) : null}
						</div>
					</div>
					{review.total > 0 ? (
						<div
							className="flex shrink-0 items-center rounded-[var(--radius-sm)] border border-border-default"
							role="tablist"
							aria-label="Plan or review"
						>
							{(
								[
									{ id: "plan", label: "Plan" },
									{ id: "review", label: `Review (${review.total - review.reviewed})` },
								] as const
							).map((tab) => (
								<button
									key={tab.id}
									type="button"
									role="tab"
									data-testid={`plan-mode-${tab.id}`}
									aria-selected={mode === tab.id}
									onClick={() => setMode(tab.id)}
									className={cn(
										"px-sm py-xs tr-text-ui",
										mode === tab.id
											? "bg-control-bg-hovered text-text-default"
											: "text-text-muted hover:text-text-default",
									)}
								>
									{tab.label}
								</button>
							))}
						</div>
					) : null}
					<button
						type="button"
						data-testid="plan-copy-markdown"
						onClick={() => {
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
						}}
						title="Copy the plan as markdown"
						className="flex shrink-0 items-center gap-xs rounded-[var(--radius-sm)] px-sm py-xs tr-text-ui text-text-muted hover:bg-control-bg-hovered hover:text-text-default"
					>
						<Copy className="size-3.5" /> Copy
					</button>
					<button
						type="button"
						data-testid="plan-save-markdown"
						onClick={() => downloadMarkdown(exportMarkdown(), title)}
						title="Save the plan as a .md file"
						className="flex shrink-0 items-center gap-xs rounded-[var(--radius-sm)] px-sm py-xs tr-text-ui text-text-muted hover:bg-control-bg-hovered hover:text-text-default"
					>
						<Download className="size-3.5" /> Save .md
					</button>
				</header>
				{overallSummary ? (
					<p
						data-testid="plan-overall-summary"
						className="mb-lg rounded-[var(--radius-md)] bg-container-elevated-bg p-md tr-text-ui text-text-default"
					>
						{overallSummary}
					</p>
				) : null}
				{/* Review mode is only reachable while reviewable items exist — if they vanish (a re-plan), the
				    toggle disappears and the page falls back to the plan rather than stranding an empty mode. */}
				{mode === "review" && review.total > 0 ? (
					<PlanReviewList
						plan={data}
						workspaceId={workspaceId}
						onOpenCommit={onOpenCommit}
						onApprove={plan.approve}
						onAskFix={plan.askFix}
					/>
				) : empty ? (
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
								onOpenCommit={onOpenCommit}
								onApprove={plan.approve}
								onAskFix={plan.askFix}
								onStartReview={startReview}
							/>
						))}
						{loose.length > 0 ? (
							<section className="mb-lg" data-testid="plan-loose">
								{groups.length > 0 ? (
									<h2 className="mb-xs border-border-default border-b pb-xs tr-title-compact text-text-default">
										Other
									</h2>
								) : null}
								<ul className="flex flex-col">
									{loose.map((item) => (
										<ItemBlock
											key={item.id}
											item={item}
											workspaceId={workspaceId}
											onOpenCommit={onOpenCommit}
											onApprove={plan.approve}
											onAskFix={plan.askFix}
											onStartReview={startReview}
										/>
									))}
								</ul>
							</section>
						) : null}
					</>
				)}
			</div>
		</div>
	);
}
