import type { GitFileChange, TodoItem, TodoPlan } from "@thinkrail/contracts";
import {
	Check,
	ChevronDown,
	ChevronRight,
	CircleDashed,
	GitCommitHorizontal,
	MessageSquareWarning,
} from "lucide-react";
import { useState } from "react";
import { VerificationBadge } from "../chat/planKit";
import { changeSetStat, itemRevisions, reviewableItems } from "../chat/planView";
import { cn } from "../lib";
import { DiffStatBadge } from "./DiffStatBadge";
import { openDiffInTab } from "./openTabs";
import { FileRow } from "./PlanPane";

// The plan page's REVIEW mode (SPEC §Plan page / task-todo-review-workflow): the plan's reviewable
// items — exactly those the host decorated with `review` (reviewable ≡ carries a host change set) —
// rendered summary-first: title → the agent's completion summary → the change set (per committed
// revision) → Approve / Ask to fix. A `changes_requested` item whose artifact list grew shows the
// "changed since review" delta (the commits not in the review watermark), so the user re-reviews only
// what the fix touched, never the original diff again. Presentational + callbacks; the data and the
// review ops come from `useChatTodos` via `PlanPane`.

const STATE_LABEL = {
	unreviewed: "Unreviewed",
	reviewed: "Reviewed",
	changes_requested: "Changes requested",
} as const;

/** One committed revision as a collapsible file list: sha chip + `N files · +A −R` + rows. */
function RevisionBlock({
	sha,
	files,
	workspaceId,
	newSinceReview,
	defaultExpanded,
	onOpenCommit,
}: {
	sha: string;
	files: GitFileChange[] | undefined;
	workspaceId: string;
	/** True when this revision landed after the user's last review action — the delta to re-review. */
	newSinceReview: boolean;
	defaultExpanded: boolean;
	onOpenCommit: (sha: string) => void;
}) {
	const [expanded, setExpanded] = useState(defaultExpanded);
	const Chevron = expanded ? ChevronDown : ChevronRight;
	const stat = files ? changeSetStat(files) : null;
	return (
		<div
			className="mt-xs"
			data-testid="review-revision"
			data-sha={sha}
			data-new={newSinceReview}
			data-expanded={expanded}
		>
			<div className="flex items-center gap-sm">
				<button
					type="button"
					data-testid="review-revision-toggle"
					aria-expanded={expanded}
					onClick={() => setExpanded((v) => !v)}
					className="flex min-w-0 items-center gap-xs rounded-[var(--radius-sm)] px-xs py-2xs text-left hover:bg-control-bg-hovered"
				>
					<Chevron className="size-3.5 shrink-0 text-text-muted" />
					{newSinceReview ? (
						<span className="shrink-0 tr-text-metadata text-feedback-warning">
							changed since review
						</span>
					) : null}
					<span className="shrink-0 tr-text-metadata text-text-subtle">
						{stat ? `${stat.count} ${stat.count === 1 ? "file" : "files"}` : "commit"}
					</span>
				</button>
				<button
					type="button"
					data-testid="review-commit-chip"
					onClick={() => onOpenCommit(sha)}
					title="Open this revision in the Changes panel"
					className="flex shrink-0 items-center gap-xs rounded-[var(--radius-sm)] px-xs py-2xs tr-code-text text-text-subtle hover:bg-control-bg-hovered hover:text-text-default"
				>
					<GitCommitHorizontal className="size-3.5" />
					{sha.slice(0, 7)}
				</button>
				{stat ? <DiffStatBadge added={stat.added} removed={stat.removed} /> : null}
			</div>
			{expanded && files ? (
				<ul className="flex flex-col">
					{files.map((file) => (
						<FileRow
							key={file.path}
							file={file}
							onOpen={() =>
								void openDiffInTab(workspaceId, { kind: "commit", sha }, file.path, "preview")
							}
						/>
					))}
				</ul>
			) : null}
			{expanded && !files ? (
				<p className="px-xs tr-text-metadata text-text-subtle">
					This revision's commit is no longer resolvable.
				</p>
			) : null}
		</div>
	);
}

/** The Ask-to-fix affordance: a button that unfolds into a feedback textarea + Send/Cancel. */
function AskFixForm({ onSend }: { onSend: (feedback: string) => Promise<void> }) {
	const [open, setOpen] = useState(false);
	const [text, setText] = useState("");
	const [busy, setBusy] = useState(false);
	if (!open) {
		return (
			<button
				type="button"
				data-testid="review-fix"
				onClick={() => setOpen(true)}
				className="rounded-[var(--radius-sm)] border border-border-default px-sm py-xs tr-text-ui text-text-default hover:bg-control-bg-hovered"
			>
				Ask to fix
			</button>
		);
	}
	const send = async () => {
		const feedback = text.trim();
		if (!feedback || busy) return;
		setBusy(true);
		try {
			await onSend(feedback);
			setOpen(false);
			setText("");
		} catch {
			// keep the typed feedback so the user can retry; useChatTodos surfaced the failure
		} finally {
			setBusy(false);
		}
	};
	return (
		<div className="flex w-full flex-col gap-xs" data-testid="review-fix-form">
			<textarea
				data-testid="review-fix-input"
				value={text}
				onChange={(e) => setText(e.target.value)}
				// Focus on mount — the form only exists after an explicit "Ask to fix" click.
				ref={(el) => el?.focus()}
				rows={3}
				placeholder="What should change? The agent gets this step, its summary, its diff, and your note."
				className="w-full resize-y rounded-[var(--radius-sm)] border border-border-default bg-container-content-bg px-sm py-xs tr-text-ui text-text-default outline-none placeholder:text-text-muted focus:border-control-border-active"
			/>
			<div className="flex items-center gap-sm">
				<button
					type="button"
					data-testid="review-fix-send"
					disabled={busy || !text.trim()}
					onClick={() => void send()}
					className="rounded-[var(--radius-sm)] bg-primary px-sm py-xs tr-text-ui text-text-on-primary hover:opacity-90 disabled:opacity-50"
				>
					{busy ? "Sending…" : "Send to agent"}
				</button>
				<button
					type="button"
					onClick={() => setOpen(false)}
					className="rounded-[var(--radius-sm)] px-sm py-xs tr-text-ui text-text-muted hover:bg-control-bg-hovered"
				>
					Cancel
				</button>
			</div>
		</div>
	);
}

/** One reviewable item, summary-first: title + state → summary → feedback quote → revisions → actions. */
function ReviewCard({
	item,
	workspaceId,
	onOpenCommit,
	onApprove,
	onAskFix,
}: {
	item: TodoItem;
	workspaceId: string;
	onOpenCommit: (sha: string) => void;
	onApprove: (id: string) => Promise<void>;
	onAskFix: (id: string, feedback: string) => Promise<void>;
}) {
	const review = item.review;
	const [busy, setBusy] = useState(false);
	if (!review) return null;
	const revisions = itemRevisions(item);
	const unreviewed = new Set(review.unreviewedShas ?? []);
	const hasDelta = unreviewed.size > 0;
	const fallbackPaths = (item.artifacts ?? []).flatMap((a) =>
		a.kind === "change" && a.path ? [a.path] : [],
	);
	const settled = review.state === "reviewed" && !hasDelta;
	const fixing = review.state === "changes_requested" && item.status !== "done" && !hasDelta;
	const approve = async () => {
		if (busy) return;
		setBusy(true);
		try {
			await onApprove(item.id);
		} finally {
			setBusy(false);
		}
	};
	return (
		<section
			className="mb-lg rounded-[var(--radius-md)] border border-border-default p-md"
			data-testid="review-item"
			data-state={review.state}
			data-delta={hasDelta}
		>
			<div className="flex items-start gap-sm">
				{settled ? (
					<Check className="mt-2xs size-4 shrink-0 text-primary" />
				) : review.state === "changes_requested" ? (
					<MessageSquareWarning className="mt-2xs size-4 shrink-0 text-feedback-warning" />
				) : (
					<CircleDashed className="mt-2xs size-4 shrink-0 text-text-muted" />
				)}
				<div className="min-w-0 flex-1">
					<div className="flex items-baseline gap-sm">
						<h3 className="min-w-0 flex-1 truncate tr-title-compact text-text-default">
							{item.title}
						</h3>
						{revisions.length > 1 ? (
							<span className="shrink-0 tr-text-eyebrow text-text-subtle">
								Revision {revisions.length}
							</span>
						) : null}
						<span
							data-testid="review-state"
							className={cn(
								"shrink-0 tr-text-eyebrow",
								settled
									? "text-primary"
									: review.state === "changes_requested"
										? "text-feedback-warning"
										: "text-text-subtle",
							)}
						>
							{hasDelta ? "Revision to review" : STATE_LABEL[review.state]}
						</span>
					</div>
					<p
						data-testid="review-summary"
						className={cn(
							"mt-xs tr-text-ui",
							item.summary ? "text-text-default" : "text-text-subtle italic",
						)}
					>
						{item.summary ?? "No summary provided."}
					</p>
					{/* Verification is first-class on a review card: a named check gets the badge, and a DONE
					    reviewable item with NO verification line shows the gap — silence must be visible. (A
					    re-opened item mid-fix shows nothing: its verification is still being earned.) */}
					{item.status === "done" ? (
						<div className="mt-xs">
							{item.verification ? (
								<VerificationBadge verification={item.verification} />
							) : (
								<span
									data-testid="review-no-verification"
									className="tr-text-metadata text-feedback-warning italic"
								>
									No verification reported.
								</span>
							)}
						</div>
					) : null}
					{review.feedback ? (
						<blockquote
							data-testid="review-feedback"
							className="mt-sm border-feedback-warning border-l-2 pl-sm tr-text-ui text-text-muted"
						>
							Requested: {review.feedback}
						</blockquote>
					) : null}
					{fixing ? (
						<p className="mt-xs tr-text-metadata text-text-subtle">Fix in progress…</p>
					) : null}
					{revisions.length > 0 ? (
						<div className="mt-sm">
							{[...revisions].reverse().map((rev, i) => (
								<RevisionBlock
									key={rev.sha}
									sha={rev.sha}
									files={rev.files}
									workspaceId={workspaceId}
									newSinceReview={unreviewed.has(rev.sha)}
									// Newest revision unfolds when it's the thing to review; history stays folded.
									defaultExpanded={i === 0 && (hasDelta || review.state === "unreviewed")}
									onOpenCommit={onOpenCommit}
								/>
							))}
						</div>
					) : null}
					{fallbackPaths.length > 0 ? (
						<ul className="mt-sm flex flex-col" data-testid="review-paths">
							{fallbackPaths.map((path) => (
								<FileRow
									key={path}
									file={{ path, status: "modified" }}
									onOpen={() =>
										void openDiffInTab(workspaceId, { kind: "branch" }, path, "preview")
									}
								/>
							))}
						</ul>
					) : null}
					{!settled || hasDelta ? (
						<div className="mt-md flex items-start gap-sm">
							<button
								type="button"
								data-testid="review-approve"
								disabled={busy}
								onClick={() => void approve()}
								className="rounded-[var(--radius-sm)] bg-primary px-sm py-xs tr-text-ui text-text-on-primary hover:opacity-90 disabled:opacity-50"
							>
								Approve
							</button>
							<AskFixForm onSend={(feedback) => onAskFix(item.id, feedback)} />
						</div>
					) : null}
				</div>
			</div>
		</section>
	);
}

/** Review-order buckets: things awaiting the user first, then awaited fixes, then the reviewed history. */
function reviewOrder(item: TodoItem): number {
	const r = item.review;
	if (!r) return 3;
	const hasDelta = (r.unreviewedShas?.length ?? 0) > 0;
	if (r.state === "unreviewed" || hasDelta) return 0;
	if (r.state === "changes_requested") return 1;
	return 2;
}

export function PlanReviewList({
	plan,
	workspaceId,
	onOpenCommit,
	onApprove,
	onAskFix,
}: {
	plan: TodoPlan;
	workspaceId: string;
	onOpenCommit: (sha: string) => void;
	onApprove: (id: string) => Promise<void>;
	onAskFix: (id: string, feedback: string) => Promise<void>;
}) {
	const items = [...reviewableItems(plan)].sort((a, b) => reviewOrder(a) - reviewOrder(b));
	if (items.length === 0) {
		return (
			<p className="text-text-subtle tr-text-ui">
				Nothing to review yet — steps that change code show up here once they're done.
			</p>
		);
	}
	return (
		<div data-testid="review-list">
			{items.map((item) => (
				<ReviewCard
					key={item.id}
					item={item}
					workspaceId={workspaceId}
					onOpenCommit={onOpenCommit}
					onApprove={onApprove}
					onAskFix={onAskFix}
				/>
			))}
		</div>
	);
}
