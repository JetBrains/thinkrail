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

/** One editable surface's review slice: the comments pinned to THIS side, its composer, and a pending
 * focus deep link that resolved to one of its threads (see `EditorReview`). */
export interface SideReview {
	threads: ReviewThreadData[];
	commenting: ReviewCommentingCallbacks;
	/** A pending "focus this comment" deep link resolved to a thread on this side (see the store's
	 * `reviewFocusRequest`); the pane reveals/scrolls it, then calls `onFocusHandled`. */
	focus: { id: string; line: number } | null;
}

/** Everything a Monaco surface needs to carry review mode: the inline thread cards, the composer's
 * save/send, and the cards' actions. One object so the panes stay one-liner integrators. The top level
 * IS the worktree side (what every single-content surface renders); a diff additionally mounts `base`
 * on its ORIGINAL editor. */
export interface EditorReview extends SideReview {
	actions: ReviewThreadActions;
	onFocusHandled: () => void;
	/** The diff's ORIGINAL (base) side. Only `MonacoDiff` mounts it — no other surface has one. */
	base: SideReview;
}

/**
 * The ONE review integration behind `FilePane` and `DiffPane` (they differ only in the comment `kind`
 * and in whether they have a base side). Composer: Save = `review.commentAdd` with just the
 * `lineRange` + the anchor's side (the host reads THAT side's content to fill `contentHash` + the
 * drift-tolerant `textQuote`; a `null` selection is the preview's "couldn't locate the fragment"
 * degrade — a whole-file comment, never wrong lines); Send = save + `sendReviewComment` (the file's
 * review chat, tab opened). Thread cards: Send delegates to the same `reviewSend` path, Delete (a
 * DRAFT-only action — once sent, a comment is a record) to `review.commentDelete`. Failures toast and
 * REJECT so the calling widget keeps its state for a retry.
 *
 * **The two diff sides are two anchor spaces, never one.** A base-side selection is saved as
 * `side: "base"` with the tab's `scope` (which is what lets the host resolve the very blob the original
 * editor is showing and stamp it as `baseRef`) — it is not translated into worktree line numbers, which
 * would silently re-point a remark about a deleted or rewritten line at whatever now sits there.
 */
export function useFileReview(
	workspaceId: string,
	path: string,
	kind: "inline" | "diff",
	/** The diff tab's scope — required for base-side commenting; a plain file tab has no base side. */
	scope?: GitDiffScope,
): EditorReview {
	const comments = useAppStore((s) => s.reviewsByWorkspace[workspaceId]?.comments);
	const threads = useMemo(() => fileThreads(comments, path, "worktree"), [comments, path]);
	const baseThreads = useMemo(() => fileThreads(comments, path, "base"), [comments, path]);
	const focusRequest = useAppStore((s) => s.reviewFocusRequest);
	const focusId =
		focusRequest && focusRequest.workspaceId === workspaceId ? focusRequest.commentId : null;
	// Resolved per side: each surface reveals only what it actually renders, so a base-side deep link
	// can't scroll the worktree editor to a line that means something else.
	const focus = useMemo(() => resolveFocus(threads, focusId), [threads, focusId]);
	const baseFocus = useMemo(() => resolveFocus(baseThreads, focusId), [baseThreads, focusId]);

	// `scope` is the tab's own stored object (stable per tab), so it can be a plain dependency.
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
			// The in-card body edit (drafts only — the server enforces it). Convergence lands via the
			// `review.changed` push like every other mutation.
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
			onFocusHandled: () => useAppStore.getState().clearReviewFocus(),
			base: { threads: baseThreads, commenting: baseCommenting, focus: baseFocus },
		}),
		[threads, commenting, actions, focus, baseThreads, baseCommenting, baseFocus],
	);
}

/** The requested comment as a reveal target, when it is one of this side's rendered threads. */
function resolveFocus(
	threads: ReviewThreadData[],
	focusId: string | null,
): { id: string; line: number } | null {
	if (!focusId) return null;
	const thread = threads.find((t) => t.id === focusId);
	return thread ? { id: thread.id, line: thread.startLine } : null;
}

/** The composer callbacks for one side — the same save/send pair, differing only in the anchor's side
 * (and, for `base`, the scope the host resolves its ref from). */
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
			// `add` reports its own failure; `sendReviewComment` reports the send's. Either rejection
			// keeps the composer open with the text intact.
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
