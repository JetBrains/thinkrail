import type { GitDiffScope, ReviewAnchor } from "@thinkrail/contracts";
import { useMemo } from "react";
import type { AnchorDraft, ReviewThread, ReviewThreadActions, SurfaceReview } from "@/resources";
import { toast, useAppStore } from "../store";
import { errorText, getTransport } from "../transport";
import { fileThreads } from "./reviewModel";
import { sendReviewComment } from "./reviewSend";

export interface FileReview {
	worktree: SurfaceReview;
	base: SurfaceReview;
}

export function useFileReview(
	workspaceId: string,
	path: string,
	kind: "inline" | "diff",
	scope?: GitDiffScope,
): FileReview {
	const comments = useAppStore((state) => state.reviewsByWorkspace[workspaceId]?.comments);
	const worktreeThreads = useMemo(() => fileThreads(comments, path, "worktree"), [comments, path]);
	const baseThreads = useMemo(() => fileThreads(comments, path, "base"), [comments, path]);
	const focusRequest = useAppStore((state) => state.reviewFocusRequest);
	const focusId =
		focusRequest && focusRequest.workspaceId === workspaceId ? focusRequest.commentId : null;
	const worktreeFocus = useMemo(
		() => resolveFocus(worktreeThreads, focusId),
		[worktreeThreads, focusId],
	);
	const baseFocus = useMemo(() => resolveFocus(baseThreads, focusId), [baseThreads, focusId]);
	const worktreeCommenting = useMemo(
		() => sideCommenting(workspaceId, path, kind, "worktree", scope),
		[workspaceId, path, kind, scope],
	);
	const baseCommenting = useMemo(
		() => sideCommenting(workspaceId, path, kind, "base", scope),
		[workspaceId, path, kind, scope],
	);
	const actions = useMemo<ReviewThreadActions>(
		() => ({
			onSendComment: (id) => sendReviewComment(workspaceId, id),
			onDeleteComment: async (id) => {
				try {
					await getTransport().request("review.commentDelete", { workspaceId, id });
				} catch (error) {
					toast.error(errorText(error), "Couldn't delete the draft");
					throw error;
				}
			},
			onUpdateComment: async (id, body) => {
				try {
					await getTransport().request("review.commentUpdate", { workspaceId, id, body });
				} catch (error) {
					toast.error(errorText(error), "Couldn't update the comment");
					throw error;
				}
			},
		}),
		[workspaceId],
	);
	const onFocusHandled = useMemo(
		() => () => useAppStore.getState().clearReviewFocus(focusId ?? undefined),
		[focusId],
	);

	return useMemo(
		() => ({
			worktree: {
				threads: worktreeThreads,
				commenting: worktreeCommenting,
				actions,
				focus: worktreeFocus,
				onFocusHandled,
			},
			base: {
				threads: baseThreads,
				commenting: baseCommenting,
				actions,
				focus: baseFocus,
				onFocusHandled,
			},
		}),
		[
			worktreeThreads,
			worktreeCommenting,
			actions,
			worktreeFocus,
			onFocusHandled,
			baseThreads,
			baseCommenting,
			baseFocus,
		],
	);
}

function resolveFocus(
	threads: ReviewThread[],
	focusId: string | null,
): { id: string; anchor: ReviewAnchor } | null {
	if (!focusId) return null;
	const thread = threads.find((candidate) => candidate.id === focusId);
	return thread ? { id: thread.id, anchor: thread.anchor } : null;
}

function sideCommenting(
	workspaceId: string,
	path: string,
	kind: "inline" | "diff",
	side: ReviewAnchor["side"],
	scope: GitDiffScope | undefined,
): SurfaceReview["commenting"] {
	const add = (draft: AnchorDraft, body: string) =>
		getTransport().request("review.commentAdd", {
			workspaceId,
			kind: draft.selectors.length === 0 ? "file" : kind,
			anchor: { path, side, selectors: draft.selectors },
			body,
			...(scope ? { scope } : {}),
		});
	return {
		onSave: async (draft, text) => {
			try {
				await add(draft, text);
			} catch (error) {
				toast.error(errorText(error), "Couldn't save the comment");
				throw error;
			}
		},
		onSend: async (draft, text) => {
			let comment: Awaited<ReturnType<typeof add>>;
			try {
				comment = await add(draft, text);
			} catch (error) {
				toast.error(errorText(error), "Couldn't save the comment");
				throw error;
			}
			await sendReviewComment(workspaceId, comment.id);
		},
	};
}
