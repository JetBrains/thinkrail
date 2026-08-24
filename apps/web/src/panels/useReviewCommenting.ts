import type { GitDiffScope, ReviewAnchor } from "@thinkrail/contracts";
import { useMemo } from "react";
import { toast, useAppStore } from "../store";
import { errorText, getTransport } from "../transport";
import type { LineSelection } from "./reviewGutter";
import { fileThreads } from "./reviewModel";
import { sendReviewComment } from "./reviewSend";
import type {
	ReviewCommentingCallbacks,
	ReviewThreadActions,
	ReviewThreadData,
} from "./reviewWidgets";

export interface SideReview {
	threads: ReviewThreadData[];
	commenting: ReviewCommentingCallbacks;
	focus: { id: string; line: number } | null;
}

export interface EditorReview extends SideReview {
	actions: ReviewThreadActions;
	onFocusHandled: () => void;
	base: SideReview;
}

export function useFileReview(
	workspaceId: string,
	path: string,
	kind: "inline" | "diff",
	scope?: GitDiffScope,
): EditorReview {
	const comments = useAppStore((s) => s.reviewsByWorkspace[workspaceId]?.comments);
	const threads = useMemo(() => fileThreads(comments, path, "worktree"), [comments, path]);
	const baseThreads = useMemo(() => fileThreads(comments, path, "base"), [comments, path]);
	const focusRequest = useAppStore((s) => s.reviewFocusRequest);
	const focusId =
		focusRequest && focusRequest.workspaceId === workspaceId ? focusRequest.commentId : null;
	const focus = useMemo(() => resolveFocus(threads, focusId), [threads, focusId]);
	const baseFocus = useMemo(() => resolveFocus(baseThreads, focusId), [baseThreads, focusId]);

	const commenting = useMemo(
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
				} catch (err) {
					toast.error(errorText(err), "Couldn't delete the draft");
					throw err;
				}
			},
			onUpdateComment: async (id, body) => {
				try {
					await getTransport().request("review.commentUpdate", { workspaceId, id, body });
				} catch (err) {
					toast.error(errorText(err), "Couldn't update the comment");
					throw err;
				}
			},
		}),
		[workspaceId],
	);

	return useMemo(
		() => ({
			threads,
			commenting,
			actions,
			focus,
			onFocusHandled: () => useAppStore.getState().clearReviewFocus(focusId ?? undefined),
			base: { threads: baseThreads, commenting: baseCommenting, focus: baseFocus },
		}),
		[threads, commenting, actions, focus, focusId, baseThreads, baseCommenting, baseFocus],
	);
}

function resolveFocus(
	threads: ReviewThreadData[],
	focusId: string | null,
): { id: string; line: number } | null {
	if (!focusId) return null;
	const thread = threads.find((t) => t.id === focusId);
	return thread ? { id: thread.id, line: thread.startLine } : null;
}

function sideCommenting(
	workspaceId: string,
	path: string,
	kind: "inline" | "diff",
	side: ReviewAnchor["side"],
	scope: GitDiffScope | undefined,
): ReviewCommentingCallbacks {
	const add = (selection: LineSelection | null, body: string) =>
		getTransport().request("review.commentAdd", {
			workspaceId,
			kind: selection ? kind : "file",
			anchor: {
				path,
				side,
				selectors: selection ? [{ kind: "lineRange", ...selection }] : [],
			},
			body,
			...(scope ? { scope } : {}),
		});
	return {
		onSave: async (selection, text) => {
			try {
				await add(selection, text);
			} catch (err) {
				toast.error(errorText(err), "Couldn't save the comment");
				throw err;
			}
		},
		onSend: async (selection, text) => {
			let comment: Awaited<ReturnType<typeof add>>;
			try {
				comment = await add(selection, text);
			} catch (err) {
				toast.error(errorText(err), "Couldn't save the comment");
				throw err;
			}
			await sendReviewComment(workspaceId, comment.id);
		},
	};
}
