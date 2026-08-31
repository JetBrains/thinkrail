import {
	RiRobotLine as Bot,
	RiCheckboxCircleLine as CheckCircle2,
	RiArrowDownSLine as ChevronDown,
	RiArrowRightSLine as ChevronRight,
	RiFileTextLine as FileText,
	RiChat1Line as MessageSquare,
	RiSendPlaneLine as Send,
	RiDeleteBin6Line as Trash2,
} from "@remixicon/react";
import type { ReviewComment } from "@thinkrail/contracts";
import { useState } from "react";
import { QuietScrollArea } from "@/components/QuietScrollArea";
import { PopoverTrigger } from "@/components/ui/popover";
import { IconTooltip } from "@/components/ui/tooltip";
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
	allDraftIds,
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

export function ReviewPanel({ workspaceId, failed }: { workspaceId: string; failed: boolean }) {
	const snapshot = useAppStore((s) => s.reviewsByWorkspace[workspaceId]);
	const activeReviewedPath = useAppStore((s) => selectActiveReviewedPath(s, workspaceId));
	const [sending, setSending] = useState(false);
	const [clearing, setClearing] = useState(false);
	const [expanded, setExpanded] = useState<ReadonlySet<string | null>>(
		() => new Set(activeReviewedPath === null ? [] : [activeReviewedPath]),
	);

	const [followedPath, setFollowedPath] = useState(activeReviewedPath);
	if (followedPath !== activeReviewedPath) {
		setFollowedPath(activeReviewedPath);
		if (activeReviewedPath !== null && !expanded.has(activeReviewedPath))
			setExpanded(new Set(expanded).add(activeReviewedPath));
	}

	const openChat = (sessionId: string) => openChatInTab(workspaceId, sessionId);

	const openSurface = (path: string, surface: ReviewSurface) => {
		if (surface.kind === "file") {
			void openFileInTab(workspaceId, path, "preview");
			return;
		}
		const scope = surface.scope ?? selectDiffScope(useAppStore.getState(), workspaceId);
		void openDiffInTab(workspaceId, scope, path, "preview");
	};

	const navigateTo = (comment: ReviewComment) => {
		const path = comment.anchor?.path;
		if (!path) return;
		useAppStore.getState().requestReviewFocus(workspaceId, comment.id);
		openSurface(path, commentSurface(comment));
	};

	const sendOne = async (comment: ReviewComment) => {
		setSending(true);
		try {
			await sendReviewComment(workspaceId, comment.id);
		} catch {
		} finally {
			setSending(false);
		}
	};

	if (failed && !snapshot) {
		return (
			<p data-testid="review-failed" className="px-8 py-4 tr-text-metadata text-text-subtle">
				Couldn't load the review — check the connection and switch back to retry.
			</p>
		);
	}
	if (!snapshot) return <p className="px-8 py-4 tr-text-metadata text-text-subtle">Loading…</p>;

	const files = fileSummaries(snapshot.comments, snapshot.review.doneFiles);
	const finishFile = async (path: string | null) => {
		try {
			await getTransport().request("review.fileDone", { workspaceId, path: path ?? "" });
		} catch (err) {
			toast.error(errorText(err), "Couldn't finish the file's review");
		}
	};
	const clearReview = async () => {
		try {
			await getTransport().request("review.close", { workspaceId });
		} catch (err) {
			toast.error(errorText(err), "Couldn't clear the review");
		}
	};
	const hasDrafts = allDraftIds(snapshot.comments).length > 0;
	const hasComments = snapshot.comments.length > 0;
	const toggleFile = (file: ReviewFileSummary) => {
		const isOpen = expanded.has(file.path);
		const next = new Set(expanded);
		if (isOpen) next.delete(file.path);
		else next.add(file.path);
		setExpanded(next);
		if (!isOpen && file.path)
			openSurface(file.path, reviewFileSurface(snapshot.comments, file.path));
	};

	return (
		<div className="flex h-full min-h-0 flex-col" data-testid="review-panel">
			{hasComments && (
				<div className="flex h-panel-header-row shrink-0 items-center justify-end gap-8 border-border-default border-b px-12">
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
						<IconTooltip label="Clear review — archive sent comments" wrapTrigger>
							<PopoverTrigger asChild>
								<button
									type="button"
									data-testid="review-clear"
									aria-label="Clear review"
									className="flex shrink-0 items-center gap-4 px-4 tr-text-metadata text-text-subtle hover:text-feedback-error"
								>
									<Trash2 className="size-14" />
									Clear
								</button>
							</PopoverTrigger>
						</IconTooltip>
					</ConfirmPopover>
				</div>
			)}
			<QuietScrollArea className="min-h-0 flex-1" viewportClassName="p-12">
				{files.length === 0 ? (
					<p data-testid="review-empty" className="px-8 py-4 tr-text-metadata text-text-subtle">
						{hasComments
							? "All reviewed files are finished — Clear to archive them and start a fresh review."
							: "No review comments yet. Select lines in a file or diff and click the comment icon."}
					</p>
				) : (
					<ul>
						{files.map((file) => {
							const isOpen = expanded.has(file.path);
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
											className="flex min-w-0 flex-1 items-center gap-8 px-4 py-4 text-left tr-text-ui"
											onClick={() => toggleFile(file)}
										>
											{isOpen ? (
												<ChevronDown className="size-16 shrink-0 text-text-subtle" />
											) : (
												<ChevronRight className="size-16 shrink-0 text-text-subtle" />
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
											<IconTooltip label="Done — finish this file's review">
												<button
													type="button"
													data-testid="review-file-done"
													aria-label="Done — finish this file's review"
													onClick={() => void finishFile(file.path)}
													className="flex shrink-0 items-center py-4 pr-4 pl-4 text-text-subtle hover:text-feedback-success"
												>
													<CheckCircle2 className="size-14" />
												</button>
											</IconTooltip>
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
			</QuietScrollArea>
		</div>
	);
}

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
		<div className="px-4 pb-4 pl-12">
			{drafts.length > 0 && (
				<div className="flex items-center justify-end gap-4 px-4 py-4">
					<SendReviewButton workspaceId={workspaceId} path={path} testid="review-panel-send" />
				</div>
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
	ordinal?: number;
	sending: boolean;
	onSend: () => void;
	onOpenChat: (sessionId: string) => void;
	onNavigate: () => void;
}) {
	const isDraft = comment.status === "draft";
	const [confirmDelete, setConfirmDelete] = useState(false);
	const ref = lineRef(comment);
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
				onClick={() => (comment.sessionId ? onOpenChat(comment.sessionId) : onNavigate())}
				title={comment.sessionId ? "Open the discussion" : "Show in file"}
				className="flex w-full items-start gap-8 rounded-[var(--radius-sm)] px-4 py-4 text-left hover:bg-control-bg-hovered"
			>
				{ordinal !== undefined ? (
					<span className="w-16 shrink-0 text-center tr-code-text text-text-subtle">
						{ordinal}.
					</span>
				) : isDraft ? (
					<PlanStatusIcon kind="pending" />
				) : (
					<GlanceGlyph glance={glance} />
				)}
				<span className="min-w-0 flex-1">
					<span className="line-clamp-2 block tr-text-ui text-text-default">{comment.body}</span>
					<span className="flex items-center gap-4">
						{comment.author === "agent" && (
							<span
								data-testid="review-comment-agent"
								title="Filed by ThinkRail's reviewer agent — not by you"
								className="flex items-center gap-2 tr-text-eyebrow text-text-subtle"
							>
								<Bot className="size-12" /> ThinkRail
							</span>
						)}
						{ref && <span className="tr-code-text text-text-subtle">{ref}</span>}
						{comment.reflection?.verdict === "refuted" ? (
							<span
								data-testid="review-comment-refuted"
								title={`An independent reflector judged this finding refuted: ${comment.reflection.reason} — it was held back from the auto-fix cycle.`}
								className="tr-text-eyebrow text-text-subtle"
							>
								refuted by reflection
							</span>
						) : comment.stale ? (
							<span
								data-testid="review-comment-stale"
								title="The code this finding was filed against was rewritten after review — it won't ride the auto-fix cycle"
								className="tr-text-eyebrow text-feedback-warning"
							>
								changed since review
							</span>
						) : (
							comment.anchorState === "outdated" && (
								<span className="tr-text-eyebrow text-text-subtle">outdated</span>
							)
						)}
					</span>
				</span>
			</button>
			<span className="absolute top-4 right-8 flex items-center gap-4 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100 has-[[data-state=open]]:opacity-100">
				{isDraft && (
					<>
						<IconTooltip label="Send this comment to the file's review chat" wrapTrigger>
							<button
								type="button"
								data-testid="review-comment-send"
								aria-label="Send this comment to the file's review chat"
								disabled={sending}
								onClick={onSend}
								className="text-text-subtle hover:text-text-default disabled:pointer-events-none"
							>
								<Send className="size-14" />
							</button>
						</IconTooltip>
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
							<IconTooltip label="Delete draft" wrapTrigger>
								<PopoverTrigger asChild>
									<button
										type="button"
										data-testid="review-comment-delete"
										aria-label="Delete draft"
										className="text-text-subtle hover:text-feedback-error"
									>
										<Trash2 className="size-14" />
									</button>
								</PopoverTrigger>
							</IconTooltip>
						</ConfirmPopover>
					</>
				)}
				{comment.sessionId && (
					<IconTooltip label="Show in file">
						<button
							type="button"
							data-testid="review-comment-file"
							aria-label="Show in file"
							onClick={onNavigate}
							className="text-text-subtle hover:text-text-default"
						>
							<FileText className="size-14" />
						</button>
					</IconTooltip>
				)}
				{comment.status === "sent" && (
					<IconTooltip label="Mark resolved">
						<button
							type="button"
							data-testid="review-comment-resolve"
							aria-label="Mark resolved"
							onClick={() => void update({ status: "resolved" })}
							className="text-text-subtle hover:text-feedback-success"
						>
							<CheckCircle2 className="size-14" />
						</button>
					</IconTooltip>
				)}
			</span>
		</div>
	);
}

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
			className="group relative flex items-center gap-8 rounded-[var(--radius-sm)] px-4 py-4"
		>
			<PlanStatusIcon kind="done" />
			<span
				className="min-w-0 flex-1 truncate tr-text-ui text-text-subtle line-through"
				title={comment.body}
			>
				{comment.body}
			</span>
			<span className="flex shrink-0 items-center gap-4 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
				{comment.sessionId && (
					<IconTooltip label="Open the linked chat">
						<button
							type="button"
							data-testid="review-comment-chat"
							aria-label="Open the linked chat"
							onClick={() => comment.sessionId && onOpenChat(comment.sessionId)}
							className="text-text-subtle hover:text-text-default"
						>
							<MessageSquare className="size-14" />
						</button>
					</IconTooltip>
				)}
			</span>
		</div>
	);
}

function GlanceGlyph({ glance }: { glance: ReturnType<typeof sessionGlance> }) {
	const { Icon, className, label } = glanceIcon(glance);
	return (
		<Icon data-glance={glance} aria-label={label} className={cn("size-16 shrink-0", className)} />
	);
}
