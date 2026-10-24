import type { GitDiffScope, ReviewAnchor } from "@thinkrail/contracts";
import { t } from "@thinkrail/locales/react";
import type {
	AnchorDraft,
	ReviewThread,
	ReviewThreadActions,
	SurfaceReview,
} from "@thinkrail/resource-renderers";
import { useMemo, useState } from "react";
import { toast, useAppStore } from "../store";
import { errorText, getTransport, supportsRichAnchors } from "../transport";
import { scopeKey } from "./changesModel";
import { fileThreads, sameThreads } from "./reviewModel";
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
	chatSessionId?: string,
): FileReview {
	const comments = useAppStore((state) => state.reviewsByWorkspace[workspaceId]?.comments);
	const worktreeThreads = useStableThreads(
		useMemo(() => fileThreads(comments, path, "worktree"), [comments, path]),
	);
	const baseThreads = useStableThreads(
		useMemo(() => fileThreads(comments, path, "base"), [comments, path]),
	);
	const focusRequest = useAppStore((state) => state.reviewFocusRequest);
	const focusId = reviewFocusId(focusRequest, workspaceId, kind, scope);
	const worktreeFocus = useMemo(
		() => resolveFocus(worktreeThreads, focusId),
		[worktreeThreads, focusId],
	);
	const baseFocus = useMemo(() => resolveFocus(baseThreads, focusId), [baseThreads, focusId]);
	const worktreeCommenting = useMemo(
		() => sideCommenting(workspaceId, path, kind, "worktree", scope, chatSessionId),
		[workspaceId, path, kind, scope, chatSessionId],
	);
	const baseCommenting = useMemo(
		() => sideCommenting(workspaceId, path, kind, "base", scope, chatSessionId),
		[workspaceId, path, kind, scope, chatSessionId],
	);
	const actions = useMemo<ReviewThreadActions>(
		() => ({
			onSendComment: (id) => sendReviewComment(workspaceId, id, chatSessionId),
			onDeleteComment: async (id) => {
				try {
					await getTransport().request("review.commentDelete", { workspaceId, id });
				} catch (error) {
					toast.error(errorText(error), t("panels.reviewCommenting.deleteFailed"));
					throw error;
				}
			},
			onUpdateComment: async (id, body) => {
				try {
					await getTransport().request("review.commentUpdate", { workspaceId, id, body });
				} catch (error) {
					toast.error(errorText(error), t("panels.reviewCommenting.updateFailed"));
					throw error;
				}
			},
		}),
		[workspaceId, chatSessionId],
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

function useStableThreads(threads: ReviewThread[]): ReviewThread[] {
	const [stable, setStable] = useState(threads);
	if (stable === threads || sameThreads(stable, threads)) return stable;
	setStable(threads);
	return threads;
}

export function reviewFocusId(
	request: ReturnType<typeof useAppStore.getState>["reviewFocusRequest"],
	workspaceId: string,
	kind: "inline" | "diff",
	scope?: GitDiffScope,
): string | null {
	if (!request || request.workspaceId !== workspaceId) return null;
	const target = request.surface;
	if (target.kind !== kind) return null;
	if (target.kind === "diff" && (!scope || scopeKey(scope) !== scopeKey(target.scope))) return null;
	return request.commentId;
}

function resolveFocus(
	threads: ReviewThread[],
	focusId: string | null,
): { id: string; anchor: ReviewAnchor } | null {
	if (!focusId) return null;
	const thread = threads.find((candidate) => candidate.id === focusId);
	return thread ? { id: thread.id, anchor: thread.anchor } : null;
}

export function commentKindForDraft(
	kind: "inline" | "diff",
	draft: AnchorDraft,
): "file" | "inline" | "diff" {
	return draft.selectors.some(
		(selector) =>
			selector.kind === "lineRange" || selector.kind === "structural" || selector.kind === "region",
	)
		? kind
		: "file";
}

export function draftNeedsRichAnchors(draft: AnchorDraft): boolean {
	return draft.selectors.some(
		(selector) => selector.kind === "region" || selector.kind === "structural",
	);
}

function sideCommenting(
	workspaceId: string,
	path: string,
	kind: "inline" | "diff",
	side: ReviewAnchor["side"],
	scope: GitDiffScope | undefined,
	chatSessionId: string | undefined,
): SurfaceReview["commenting"] {
	const add = (draft: AnchorDraft, body: string) => {
		if (
			draftNeedsRichAnchors(draft) &&
			!supportsRichAnchors(useAppStore.getState().protocolVersion)
		) {
			return Promise.reject(new Error(t("panels.reviewCommenting.hostTooOld")));
		}
		return getTransport().request("review.commentAdd", {
			workspaceId,
			kind: commentKindForDraft(kind, draft),
			anchor: { path, side, selectors: draft.selectors },
			body,
			...(scope ? { scope } : {}),
		});
	};
	return {
		onSave: async (draft, text) => {
			try {
				await add(draft, text);
			} catch (error) {
				toast.error(errorText(error), t("panels.reviewCommenting.saveFailed"));
				throw error;
			}
		},
		onSend: async (draft, text) => {
			let comment: Awaited<ReturnType<typeof add>>;
			try {
				comment = await add(draft, text);
			} catch (error) {
				toast.error(errorText(error), t("panels.reviewCommenting.saveFailed"));
				throw error;
			}
			await sendReviewComment(workspaceId, comment.id, chatSessionId);
		},
	};
}
