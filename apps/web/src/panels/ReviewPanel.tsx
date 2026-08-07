import type { ReviewComment } from "@thinkrail/contracts";
import {
	ArrowLeft,
	CheckCircle2,
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
	type ReviewSurface,
	reviewFileSurface,
	statusLabel,
} from "./reviewModel";
import { sendReviewComment } from "./reviewSend";

/**
 * The Review sidebar (RightPanel's Review tab) — PER-FILE, two levels (see panels/SPEC.md):
 * - **Files level** (the default): the files still in review — each row a path + its comment counts;
 *   clicking one opens the file's tab (the file level then follows the activation).
 * - **File level**: one file's comments. It shows AUTOMATICALLY while the active center tab is a
 *   reviewed file (RightPanel also flips to the Review tab on such an activation); the header's back
 *   arrow returns to the files level.
 * Batch send lives in the pane toolbars (`SendReviewButton`); hydration is owned by `RightPanel`
 * (`useWorkspaceReview`); every mutation converges on the store's `review.changed` fold.
 */
export function ReviewPanel({ workspaceId, failed }: { workspaceId: string; failed: boolean }) {
	const snapshot = useAppStore((s) => s.reviewsByWorkspace[workspaceId]);
	const activeReviewedPath = useAppStore((s) => selectActiveReviewedPath(s, workspaceId));
	const [sending, setSending] = useState(false);
	// The panel's level: follow the active tab ("auto"), browse all files ("all"), or a row the user
	// picked whose file tab isn't active (e.g. the whole-change-set bucket).
	const [mode, setMode] = useState<"auto" | "all" | { path: string | null }>("auto");

	// A newly activated reviewed file pulls the panel back to following it; when the active tab STOPS
	// being a reviewed file (e.g. a send just opened its chat tab), the panel PINS to the file it was
	// showing instead of falling back to the files list. Render-time state adjustment (react.dev
	// "adjusting state when a prop changes"), no effect needed.
	const [followedPath, setFollowedPath] = useState(activeReviewedPath);
	if (followedPath !== activeReviewedPath) {
		setFollowedPath(activeReviewedPath);
		if (activeReviewedPath) setMode("auto");
		else if (mode === "auto" && followedPath) setMode({ path: followedPath });
	}

	/** Open the chat a sent comment/batch lives in — the shared tab→runtime→disk escalation. */
	const openChat = (sessionId: string) => openChatInTab(workspaceId, sessionId);

	/**
	 * Open the center surface a review anchor is readable on (`reviewModel`'s {@link ReviewSurface}): the
	 * DIFF for a base-side anchor — reopened by the scope that anchor captured, so it is the very diff
	 * the remark was made against — and the plain file tab for a worktree one. A comment saved before
	 * that scope was persisted falls back to the workspace's current scope.
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
	const viewedPath =
		mode === "all" ? undefined : mode === "auto" ? (activeReviewedPath ?? undefined) : mode.path;
	const showFile = viewedPath !== undefined && files.some((f) => f.path === viewedPath);

	if (!showFile) {
		// FILES level: what's still in review.
		return (
			<div className="flex h-full min-h-0 flex-col" data-testid="review-panel">
				<div className="min-h-0 flex-1 overflow-auto">
					{files.length === 0 ? (
						<p data-testid="review-empty" className="px-sm py-xs tr-text-metadata text-text-subtle">
							No review comments yet. Select lines in a file or diff and click the comment icon.
						</p>
					) : (
						<ul>
							{files.map((file) => (
								<li key={file.path ?? "@review"}>
									<button
										type="button"
										data-testid="review-file-row"
										className="flex w-full items-center gap-sm px-sm py-xs text-left tr-text-ui hover:bg-control-bg-hovered"
										onClick={() => {
											setMode({ path: file.path });
											if (file.path)
												openSurface(file.path, reviewFileSurface(snapshot.comments, file.path));
										}}
									>
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
										<ChevronRight className="size-3.5 shrink-0 text-text-subtle" />
									</button>
								</li>
							))}
						</ul>
					)}
				</div>
			</div>
		);
	}

	// FILE level: one file's comments in the TODO plan's section flow — what the chat is already
	// working on first (In progress = sent), then Drafts (the to-do), then the muted Resolved (Done).
	const fileComments = snapshot.comments.filter((c) => (c.anchor?.path ?? null) === viewedPath);
	const inProgress = fileComments.filter((c) => c.status === "sent");
	const drafts = fileComments.filter((c) => c.status === "draft");
	const resolved = fileComments.filter((c) => c.status === "resolved");
	return (
		<div className="flex h-full min-h-0 flex-col" data-testid="review-panel">
			<div className="flex h-7 shrink-0 items-center gap-sm border-border-default border-b px-sm">
				<button
					type="button"
					data-testid="review-back"
					aria-label="All reviewed files"
					title="All reviewed files"
					onClick={() => setMode("all")}
					className="text-text-subtle hover:text-text-default"
				>
					<ArrowLeft className="size-3.5" />
				</button>
				<span className="min-w-0 flex-1 truncate tr-code-text text-text-subtle">
					{viewedPath ?? "Whole change set"}
				</span>
				{/* Everything resolved → finish from right here (the list view offers the same action). */}
				{inProgress.length === 0 && drafts.length === 0 && resolved.length > 0 && (
					<button
						type="button"
						data-testid="review-file-done"
						title="Done — finish this file's review"
						onClick={() => {
							void finishFile(viewedPath ?? null);
							setMode("all");
						}}
						aria-label="Done — finish this file's review"
						className="flex shrink-0 items-center text-text-subtle hover:text-feedback-success"
					>
						<CheckCircle2 className="size-3.5" />
					</button>
				)}
			</div>
			<div className="min-h-0 flex-1 overflow-auto px-xs py-xs">
				{inProgress.length > 0 && (
					<>
						<SectionLabel label="In progress" />
						{inProgress.map((comment) => (
							<CommentRow
								key={comment.id}
								workspaceId={workspaceId}
								comment={comment}
								sending={sending}
								onSend={() => void sendOne(comment)}
								onOpenChat={(sessionId) => void openChat(sessionId)}
								onNavigate={() => navigateTo(comment)}
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
								onSend={() => void sendOne(comment)}
								onOpenChat={(sessionId) => void openChat(sessionId)}
								onNavigate={() => navigateTo(comment)}
							/>
						))}
					</>
				)}
				{resolved.length > 0 && (
					<>
						<SectionLabel label="Resolved" />
						{resolved.map((comment) => (
							<ResolvedRow
								key={comment.id}
								comment={comment}
								onOpenChat={(sessionId) => void openChat(sessionId)}
							/>
						))}
					</>
				)}
			</div>
		</div>
	);
}

/** The active center tab's path when it is a file/diff still carrying unresolved comments — what the
 * panel's "auto" level follows (and what RightPanel's auto-flip keys on). */
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
