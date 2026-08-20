import type { ReviewComment } from "@thinkrail/contracts";
import {
	CheckCircle2,
	ChevronDown,
	ChevronRight,
	FileText,
	MessageSquare,
	Send,
	Trash2,
} from "lucide-react";
import { useState } from "react";
import { PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { PlanStatusIcon, SectionLabel } from "../chat/planKit";
import { sessionGlance } from "../chat/planView";
import { glanceIcon } from "../chat/TodoList";
import { selectDiffScope, toast, useAppStore } from "../store";
import { errorText, getTransport } from "../transport";
import { ConfirmPopover } from "./ConfirmPopover";
import { openChatInTab } from "./openChat";
import { openDiffInTab, openFileInTab } from "./openTabs";
import {
	commentSurface,
	fileSummaries,
	lineRef,
	type ReviewFileSummary,
	type ReviewSurface,
	reviewFileSurface,
	statusLabel,
} from "./reviewModel";
import { sendReviewComment } from "./reviewSend";
import { SendAllReviewsButton, SendReviewButton } from "./SendReviewButton";

/**
 * The side-only Review tool — ONE screen, an ACCORDION of the files still in review (see
 * panels/SPEC.md): each row a path + its comment counts; clicking a row unfolds its comments in place
 * AND opens the file's tab (collapsing is just a second click — it navigates nowhere). The section whose
 * file is the active center tab auto-expands, and `WorkspaceWorkbench` reveals Review for a newly active
 * reviewed surface; an expansion never auto-collapses — folding is the user's. Batch send mirrors the pane
 * toolbars: an expanded section's strip carries the same per-file `Send review (N)` (drafts-only,
 * `SendReviewButton`) + the Done finisher, the tool header a `Send all (N)` across every file — all over
 * the shared `reviewSend` batch path. Hydration is owned by `WorkspaceWorkbench`
 * (`useWorkspaceReview`); every mutation converges on the store's `review.changed` fold.
 */
export function ReviewPanel({ workspaceId, failed }: { workspaceId: string; failed: boolean }) {
	const snapshot = useAppStore((s) => s.reviewsByWorkspace[workspaceId]);
	const activeReviewedPath = useAppStore((s) => selectActiveReviewedPath(s, workspaceId));
	const [sending, setSending] = useState(false);
	const [clearing, setClearing] = useState(false);
	// The unfolded sections, keyed like `fileSummaries` rows (`null` = the whole-change-set bucket).
	// Seeded with the active reviewed file: the panel often mounts as the workbench reveals Review for
	// that activation, and the adjust-on-change below only sees later changes.
	const [expanded, setExpanded] = useState<ReadonlySet<string | null>>(
		() => new Set(activeReviewedPath === null ? [] : [activeReviewedPath]),
	);

	// A newly activated reviewed file unfolds its own section — the accordion's "follow the active
	// tab". Render-time state adjustment (react.dev "adjusting state when a prop changes"), no effect
	// needed; deactivation collapses nothing (folding is the user's gesture alone).
	const [followedPath, setFollowedPath] = useState(activeReviewedPath);
	if (followedPath !== activeReviewedPath) {
		setFollowedPath(activeReviewedPath);
		if (activeReviewedPath !== null && !expanded.has(activeReviewedPath))
			setExpanded(new Set(expanded).add(activeReviewedPath));
	}

	/** Open the chat a sent comment/batch lives in — the shared tab→runtime→disk escalation. */
	const openChat = (sessionId: string) => openChatInTab(workspaceId, sessionId);

	/**
	 * Open the center surface a review anchor is readable on (`reviewModel`'s {@link ReviewSurface}): the
	 * DIFF for a base-side anchor — a **pinned** scope on the anchor's own `baseRef`, so the original
	 * side is the very blob the remark quotes no matter how the worktree or the review target moved
	 * since — and the plain file tab for a worktree one. A comment saved before `baseRef` was stamped
	 * falls back to its captured scope, then to the workspace's current one.
	 */
	const openSurface = (path: string, surface: ReviewSurface) => {
		if (surface.kind === "file") {
			void openFileInTab(workspaceId, path, "preview");
			return;
		}
		const scope = surface.scope ?? selectDiffScope(useAppStore.getState(), workspaceId);
		void openDiffInTab(workspaceId, scope, path, "preview");
	};

	/** Row click: navigate to the comment's own surface, focused on it (the pane consumes the focus
	 * request — Monaco reveals the anchor line, the preview scrolls the in-flow card into view). */
	const navigateTo = (comment: ReviewComment) => {
		const path = comment.anchor?.path;
		if (!path) return;
		useAppStore.getState().requestReviewFocus(workspaceId, comment.id);
		openSurface(path, commentSurface(comment));
	};

	// The shared send paths (reviewSend.ts) own the request + chat-open + failure toast; this panel
	// only tracks its own busy state.
	const sendOne = async (comment: ReviewComment) => {
		setSending(true);
		try {
			await sendReviewComment(workspaceId, comment.id);
		} catch {
			// reported by the helper
		} finally {
			setSending(false);
		}
	};

	if (failed && !snapshot) {
		return (
			<p data-testid="review-failed" className="px-sm py-xs tr-text-metadata text-text-subtle">
				Couldn't load the review — check the connection and switch back to retry.
			</p>
		);
	}
	if (!snapshot) return <p className="px-sm py-xs tr-text-metadata text-text-subtle">Loading…</p>;

	const files = fileSummaries(snapshot.comments, snapshot.review.doneFiles);
	const finishFile = async (path: string | null) => {
		try {
			await getTransport().request("review.fileDone", { workspaceId, path: path ?? "" });
		} catch (err) {
			toast.error(errorText(err), "Couldn't finish the file's review");
		}
	};
	// Clear is one server-side mutation. Its `review.changed` fresh-snapshot push is the only state fold,
	// so this page and every sibling client empty together — no initiating-only `review.get` write.
	const clearReview = async () => {
		try {
			await getTransport().request("review.close", { workspaceId });
		} catch (err) {
			toast.error(errorText(err), "Couldn't clear the review");
		}
	};
	const hasDrafts = snapshot.comments.some((c) => c.status === "draft");
	// Clear (archive the review + start fresh) follows the RECORDS, not the file rows: finishing every
	// reviewed file empties `files` while resolved/sent records live on, and that is exactly when the user
	// wants to archive. Gating Clear on `files.length` stranded them with no way to close the review.
	const hasComments = snapshot.comments.length > 0;
	const toggleFile = (file: ReviewFileSummary) => {
		const isOpen = expanded.has(file.path);
		const next = new Set(expanded);
		if (isOpen) next.delete(file.path);
		else next.add(file.path);
		setExpanded(next);
		// Unfolding also opens the file's own surface; folding is quiet — it navigates nowhere.
		if (!isOpen && file.path)
			openSurface(file.path, reviewFileSurface(snapshot.comments, file.path));
	};

	return (
		<div className="flex h-full min-h-0 flex-col" data-testid="review-panel">
			{hasComments && (
				<div className="flex h-7 shrink-0 items-center justify-end gap-sm border-border-default border-b px-sm">
					{hasDrafts && <SendAllReviewsButton workspaceId={workspaceId} />}
					<ConfirmPopover
						open={clearing}
						onOpenChange={setClearing}
						title="Clear this review?"
						description="Archives sent and completed comments and starts a fresh review. Unsent drafts are discarded."
						confirmLabel="Clear"
						destructive
						confirmTestId="review-clear-confirm"
						onConfirm={() => void clearReview()}
						align="end"
					>
						<PopoverTrigger asChild>
							<button
								type="button"
								data-testid="review-clear"
								title="Clear review — archive sent comments"
								aria-label="Clear review"
								className="flex shrink-0 items-center gap-xs px-xs tr-text-metadata text-text-subtle hover:text-feedback-error"
							>
								<Trash2 className="size-3.5" />
								Clear
							</button>
						</PopoverTrigger>
					</ConfirmPopover>
				</div>
			)}
			<div className="min-h-0 flex-1 overflow-auto">
				{files.length === 0 ? (
					<p data-testid="review-empty" className="px-sm py-xs tr-text-metadata text-text-subtle">
						{hasComments
							? "All reviewed files are finished — Clear to archive them and start a fresh review."
							: "No review comments yet. Select lines in a file or diff and click the comment icon."}
					</p>
				) : (
					<ul>
						{files.map((file) => {
							const isOpen = expanded.has(file.path);
							// Everything resolved — the row itself offers the Done finisher, inline after the
							// counts (a strip below just for one glyph read as stray space).
							const finishable = file.total === 0 && file.resolved > 0;
							return (
								<li
									key={file.path ?? "@review"}
									data-testid="review-file-section"
									data-path={file.path ?? ""}
									data-expanded={isOpen}
								>
									<div className="flex items-center hover:bg-control-bg-hovered">
										<button
											type="button"
											data-testid="review-file-row"
											className="flex min-w-0 flex-1 items-center gap-sm px-sm py-xs text-left tr-text-ui"
											onClick={() => toggleFile(file)}
										>
											{isOpen ? (
												<ChevronDown className="size-3.5 shrink-0 text-text-subtle" />
											) : (
												<ChevronRight className="size-3.5 shrink-0 text-text-subtle" />
											)}
											<span className="min-w-0 flex-1 truncate text-text-muted">
												{file.path ?? "Whole change set"}
											</span>
											<span className="shrink-0 tr-text-metadata text-text-subtle">
												{[
													file.drafts > 0 && `${file.drafts} draft${file.drafts > 1 ? "s" : ""}`,
													file.total > file.drafts && `${file.total - file.drafts} sent`,
													file.resolved > 0 && `${file.resolved} resolved`,
												]
													.filter(Boolean)
													.join(" · ")}
											</span>
										</button>
										{finishable && (
											<button
												type="button"
												data-testid="review-file-done"
												title="Done — finish this file's review"
												aria-label="Done — finish this file's review"
												onClick={() => void finishFile(file.path)}
												className="flex shrink-0 items-center py-xs pr-sm pl-xs text-text-subtle hover:text-feedback-success"
											>
												<CheckCircle2 className="size-3.5" />
											</button>
										)}
									</div>
									{isOpen && (
										<FileSection
											workspaceId={workspaceId}
											path={file.path}
											comments={snapshot.comments}
											sending={sending}
											onSend={sendOne}
											onOpenChat={openChat}
											onNavigate={navigateTo}
										/>
									)}
								</li>
							);
						})}
					</ul>
				)}
			</div>
		</div>
	);
}

/**
 * One unfolded file's comments, in the TODO plan's section flow — what the chat is already working
 * on first (In progress = sent), then Drafts (the to-do), then the muted Resolved (Done) — topped,
 * while drafts exist, by the pane toolbar's `Send review (N)` (same drafts-only gate and batch path;
 * its own testid so tests can tell the sidebar's copy from the pane's). The Done finisher lives in
 * the FILE ROW, not here — a strip holding one glyph read as stray space.
 */
function FileSection({
	workspaceId,
	path,
	comments,
	sending,
	onSend,
	onOpenChat,
	onNavigate,
}: {
	workspaceId: string;
	path: string | null;
	comments: ReviewComment[];
	sending: boolean;
	onSend: (comment: ReviewComment) => Promise<void>;
	onOpenChat: (sessionId: string) => void;
	onNavigate: (comment: ReviewComment) => void;
}) {
	const fileComments = comments.filter((c) => (c.anchor?.path ?? null) === path);
	const inProgress = fileComments.filter((c) => c.status === "sent");
	const drafts = fileComments.filter((c) => c.status === "draft");
	const resolved = fileComments.filter((c) => c.status === "resolved");
	return (
		<div className="px-xs pb-xs pl-md">
			{drafts.length > 0 && (
				<div className="flex items-center justify-end gap-xs px-xs py-xs">
					<SendReviewButton workspaceId={workspaceId} path={path} testid="review-panel-send" />
				</div>
			)}
			{inProgress.length > 0 && (
				<>
					<SectionLabel label="In progress" />
					{inProgress.map((comment) => (
						<CommentRow
							key={comment.id}
							workspaceId={workspaceId}
							comment={comment}
							sending={sending}
							onSend={() => void onSend(comment)}
							onOpenChat={onOpenChat}
							onNavigate={() => onNavigate(comment)}
						/>
					))}
				</>
			)}
			{drafts.length > 0 && (
				<>
					<SectionLabel label="Drafts" />
					{drafts.map((comment, index) => (
						<CommentRow
							key={comment.id}
							workspaceId={workspaceId}
							comment={comment}
							ordinal={index + 1}
							sending={sending}
							onSend={() => void onSend(comment)}
							onOpenChat={onOpenChat}
							onNavigate={() => onNavigate(comment)}
						/>
					))}
				</>
			)}
			{resolved.length > 0 && (
				<>
					<SectionLabel label="Resolved" />
					{resolved.map((comment) => (
						<ResolvedRow key={comment.id} comment={comment} onOpenChat={onOpenChat} />
					))}
				</>
			)}
		</div>
	);
}

/** The active center tab's path when it is a file/diff still carrying unresolved comments — what the
 * panel follows and what the workbench's Review reveal keys on. */
export function selectActiveReviewedPath(
	s: {
		activeWorkspaceId: string | null;
		tabsByWorkspace: Record<string, { id: string; kind: string; path?: string }[]>;
		activeTabByWorkspace: Record<string, string | null>;
		reviewsByWorkspace: Record<string, { comments: ReviewComment[] }>;
	},
	workspaceId: string,
): string | null {
	const activeId = s.activeTabByWorkspace[workspaceId];
	const tab = (s.tabsByWorkspace[workspaceId] ?? []).find((t) => t.id === activeId);
	if (!tab || (tab.kind !== "file" && tab.kind !== "diff") || !tab.path) return null;
	const comments = s.reviewsByWorkspace[workspaceId]?.comments ?? [];
	return comments.some(
		(c) => (c.status === "draft" || c.status === "sent") && (c.anchor?.path ?? null) === tab.path,
	)
		? tab.path
		: null;
}

function CommentRow({
	workspaceId,
	comment,
	ordinal,
	sending,
	onSend,
	onOpenChat,
	onNavigate,
}: {
	workspaceId: string;
	comment: ReviewComment;
	/** Drafts number themselves (1., 2., …) instead of wearing a status glyph. */
	ordinal?: number;
	sending: boolean;
	onSend: () => void;
	onOpenChat: (sessionId: string) => void;
	onNavigate: () => void;
}) {
	const isDraft = comment.status === "draft";
	const [confirmDelete, setConfirmDelete] = useState(false);
	const ref = lineRef(comment);
	// A sent comment's glyph follows its SESSION, exactly like a TODO's in-progress item (planView's
	// glance): working dot / (?) waiting for your answer / paused. No runtime loaded = not working.
	const runtime = useAppStore((s) =>
		comment.sessionId ? s.sessions[comment.sessionId] : undefined,
	);
	const glance = runtime ? sessionGlance(runtime) : "waiting";

	const update = async (patch: { status?: ReviewComment["status"] }) => {
		try {
			await getTransport().request("review.commentUpdate", {
				workspaceId,
				id: comment.id,
				...patch,
			});
		} catch (err) {
			toast.error(errorText(err), "Couldn't update the comment");
		}
	};

	const removeDraft = async () => {
		try {
			await getTransport().request("review.commentDelete", { workspaceId, id: comment.id });
		} catch (err) {
			toast.error(errorText(err), "Couldn't delete the draft");
		}
	};

	// The whole row is the navigation gesture (file + focus on the comment); the action icons sit in
	// their own layer on top so they never trigger it. Editing happens in the in-file card, not here.
	return (
		<div
			data-testid="review-comment"
			data-status={statusLabel(comment)}
			data-anchor={comment.anchorState}
			className="group relative"
		>
			<button
				type="button"
				data-testid="review-comment-open"
				onClick={() =>
					!isDraft && comment.sessionId ? onOpenChat(comment.sessionId) : onNavigate()
				}
				title={!isDraft && comment.sessionId ? "Open the discussion" : "Show in file"}
				className="flex w-full items-start gap-sm rounded-[var(--radius-sm)] px-xs py-xs text-left hover:bg-control-bg-hovered"
			>
				{ordinal !== undefined ? (
					<span className="w-4 shrink-0 text-center tr-code-text text-text-subtle">{ordinal}.</span>
				) : isDraft ? (
					<PlanStatusIcon kind="pending" />
				) : (
					<GlanceGlyph glance={glance} />
				)}
				<span className="min-w-0 flex-1">
					<span className="line-clamp-2 block tr-text-ui text-text-default">{comment.body}</span>
					<span className="flex items-center gap-xs">
						{ref && <span className="tr-code-text text-text-subtle">{ref}</span>}
						{comment.anchorState === "outdated" && (
							<span className="tr-text-eyebrow text-text-subtle">outdated</span>
						)}
					</span>
				</span>
			</button>
			{/* Hover-revealed, like the worktree row's Remove (ProjectTree): rows stay quiet until pointed
			    at; keyboard focus and an open confirm keep them visible. */}
			<span className="absolute top-xs right-sm flex items-center gap-xs opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100 has-[[data-state=open]]:opacity-100">
				{isDraft && (
					<>
						<button
							type="button"
							data-testid="review-comment-send"
							title="Send this comment to the file's review chat"
							disabled={sending}
							onClick={onSend}
							className="text-text-subtle hover:text-text-default"
						>
							<Send className="size-3.5" />
						</button>
						{/* Drafts only: an unsent remark is the user's own scratch — once sent it is a record. */}
						<ConfirmPopover
							open={confirmDelete}
							onOpenChange={setConfirmDelete}
							title="Delete this draft?"
							confirmLabel="Delete"
							destructive
							confirmTestId="review-comment-delete-confirm"
							onConfirm={() => void removeDraft()}
							align="end"
						>
							<PopoverTrigger asChild>
								<button
									type="button"
									data-testid="review-comment-delete"
									title="Delete draft"
									className="text-text-subtle hover:text-feedback-error"
								>
									<Trash2 className="size-3.5" />
								</button>
							</PopoverTrigger>
						</ConfirmPopover>
					</>
				)}
				{!isDraft && comment.sessionId && (
					<button
						type="button"
						data-testid="review-comment-file"
						title="Show in file"
						onClick={onNavigate}
						className="text-text-subtle hover:text-text-default"
					>
						<FileText className="size-3.5" />
					</button>
				)}
				{comment.status === "sent" && (
					<button
						type="button"
						data-testid="review-comment-resolve"
						title="Mark resolved"
						onClick={() => void update({ status: "resolved" })}
						className="text-text-subtle hover:text-feedback-success"
					>
						<CheckCircle2 className="size-3.5" />
					</button>
				)}
			</span>
		</div>
	);
}

/** A resolved comment, sunk into the muted bottom section — the TODO plan's Done row styling (check +
 * struck hint text); the chat action reveals on hover. Resolved is final — no reopen (like delete and
 * rollback, undoing a review outcome isn't offered; a fresh remark is a fresh comment). */
function ResolvedRow({
	comment,
	onOpenChat,
}: {
	comment: ReviewComment;
	onOpenChat: (sessionId: string) => void;
}) {
	return (
		<div
			data-testid="review-comment-resolved"
			className="group relative flex items-center gap-sm rounded-[var(--radius-sm)] px-xs py-xs"
		>
			<PlanStatusIcon kind="done" />
			<span
				className="min-w-0 flex-1 truncate tr-text-ui text-text-subtle line-through"
				title={comment.body}
			>
				{comment.body}
			</span>
			<span className="flex shrink-0 items-center gap-xs opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
				{comment.sessionId && (
					<button
						type="button"
						data-testid="review-comment-chat"
						title="Open the linked chat"
						onClick={() => comment.sessionId && onOpenChat(comment.sessionId)}
						className="text-text-subtle hover:text-text-default"
					>
						<MessageSquare className="size-3.5" />
					</button>
				)}
			</span>
		</div>
	);
}

/** The in-progress glyph, glance-aware — the exact `TodoList` vocabulary (`glanceIcon`): working dot,
 * (?) when the session waits on an `ask_user_question`, pause when it's idle on the user. */
function GlanceGlyph({ glance }: { glance: ReturnType<typeof sessionGlance> }) {
	const { Icon, className, label } = glanceIcon(glance);
	return (
		<Icon data-glance={glance} aria-label={label} className={cn("size-4 shrink-0", className)} />
	);
}
