// The `resolve_comment` capability — a HOST-OWNED pi custom tool registered on every session (like
// `ask_user_question`): review sessions receive comment ids in their context package and close the loop
// by resolving each addressed comment, so the review sidebar tracks progress live. Registered globally
// because a review session re-opened from disk must keep the tool (the loader is built before a session
// id exists, so per-session registration would miss the restore path); a non-review session calling it
// with a made-up id just gets a loud error result. Execution is DELEGATED through a host-installed seam
// — this module never imports `reviews` (the agent module has no internal deps by contract).

import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { type Static, Type } from "typebox";

export const RESOLVE_COMMENT_TOOL_NAME = "resolve_comment";

export const ResolveCommentSchema = Type.Object({
	commentId: Type.String({
		description: 'The review comment id from the review package (e.g. "rc_1a2b3c4d").',
	}),
	note: Type.Optional(
		Type.String({
			description: "One short line: what you did about the comment (shown in the review sidebar).",
		}),
	),
});

export type ResolveCommentParams = Static<typeof ResolveCommentSchema>;

const DESCRIPTION = `Mark a review comment as resolved, after you have actually addressed it (by editing the file, or by answering when no change is needed). Only valid for comment ids you received in a review package in this conversation. If a comment is unclear or you disagree with it, reply in the conversation instead — do NOT resolve it.`;

/** What the seam's handler returns for the tool result; `resolvedBody` echoes the comment so the model
 * sees which remark it closed. */
export interface ResolveCommentOutcome {
	resolvedBody: string;
}

let handler: (commentId: string, note?: string) => ResolveCommentOutcome = () => {
	throw new Error("Review comments are not available on this host.");
};

/** Host seam: wire the tool's execution to the reviews module (`resolveCommentFromAgent`). */
export function setReviewCommentHandler(
	fn: (commentId: string, note?: string) => ResolveCommentOutcome,
): void {
	handler = fn;
}

export function createResolveCommentTool(): ToolDefinition<typeof ResolveCommentSchema> {
	return {
		name: RESOLVE_COMMENT_TOOL_NAME,
		label: "Resolve Review Comment",
		description: DESCRIPTION,
		parameters: ResolveCommentSchema,
		async execute(_toolCallId, params) {
			const { commentId, note } = params as ResolveCommentParams;
			// A bad id / state throws → pi turns it into an error tool result the model can correct on.
			const outcome = handler(commentId, note);
			return {
				content: [
					{
						type: "text",
						text: `Resolved review comment ${commentId} ("${truncate(outcome.resolvedBody, 80)}").`,
					},
				],
				details: { commentId, ...(note ? { note } : {}) },
			};
		},
	};
}

function truncate(text: string, max: number): string {
	return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

// --- The agent-reviewer capabilities (task-agent-reviewer): the plan's dedicated reviewer chat authors
// findings as review comments and settles items with a verdict. Registered globally like
// `resolve_comment` (a reviewer chat re-opened from disk must keep them); execution is delegated through
// host-installed seams keyed by the calling SESSION — the host maps it to its workspace / worker plan,
// and a non-reviewer session gets a loud error, never a silent success.

export const ADD_REVIEW_COMMENT_TOOL_NAME = "add_review_comment";

export const AddReviewCommentSchema = Type.Object({
	path: Type.String({ description: "Worktree-relative path of the file the finding is about." }),
	startLine: Type.Integer({ minimum: 1, description: "First line of the finding (1-based)." }),
	endLine: Type.Optional(
		Type.Integer({ minimum: 1, description: "Last line (default: startLine)." }),
	),
	body: Type.String({
		description:
			"The finding (markdown): what is wrong / risky and what to do instead. One finding per comment.",
	}),
});
export type AddReviewCommentParams = Static<typeof AddReviewCommentSchema>;

let addHandler: (sessionId: string, params: AddReviewCommentParams) => { commentId: string } =
	() => {
		throw new Error("Review comments are not available on this host.");
	};

/** Host seam: wire `add_review_comment` to the reviews module (agent-authored draft on the worktree side). */
export function setAddReviewCommentHandler(
	fn: (sessionId: string, params: AddReviewCommentParams) => { commentId: string },
): void {
	addHandler = fn;
}

export const REVIEW_VERDICT_TOOL_NAME = "review_verdict";

export const ReviewVerdictSchema = Type.Object({
	todoId: Type.String({ description: "The plan item id from the review package (e.g. t_ab12)." }),
	verdict: Type.Union([Type.Literal("approve"), Type.Literal("request_changes")], {
		description:
			"approve = the change set is sound (no unresolved findings); request_changes = your comments must be addressed.",
	}),
	note: Type.Optional(
		Type.String({ description: "One short line shown with the verdict (why, or what remains)." }),
	),
});
export type ReviewVerdictParams = Static<typeof ReviewVerdictSchema>;

let verdictHandler: (sessionId: string, params: ReviewVerdictParams) => { summary: string } =
	() => {
		throw new Error("Review verdicts are not available on this host.");
	};

/** Host seam: wire `review_verdict` to the todos review ops (approve / auto fix cycle). */
export function setReviewVerdictHandler(
	fn: (sessionId: string, params: ReviewVerdictParams) => { summary: string },
): void {
	verdictHandler = fn;
}

export function createAddReviewCommentTool(): ToolDefinition<typeof AddReviewCommentSchema> {
	return {
		name: ADD_REVIEW_COMMENT_TOOL_NAME,
		label: "Add Review Comment",
		description:
			"Record ONE review finding as a comment anchored to a file + line range — it appears live in the Review panel. Reviewer chats only: use it for each concrete problem you find while reviewing a plan step's change set; discussion prose stays in the conversation.",
		parameters: AddReviewCommentSchema,
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const p = params as AddReviewCommentParams;
			const { commentId } = addHandler(ctx.sessionManager.getSessionId(), p);
			return {
				content: [
					{
						type: "text",
						text: `Review comment ${commentId} recorded on ${p.path}:${p.startLine}${p.endLine && p.endLine !== p.startLine ? `-${p.endLine}` : ""}.`,
					},
				],
				details: { commentId, path: p.path },
			};
		},
	};
}

export function createReviewVerdictTool(): ToolDefinition<typeof ReviewVerdictSchema> {
	return {
		name: REVIEW_VERDICT_TOOL_NAME,
		label: "Review Verdict",
		description:
			"Finish a plan-step review with exactly ONE verdict: approve (clean — the item settles as reviewed) or request_changes (your add_review_comment findings are sent to the worker to fix). Reviewer chats only, after reading the diff — never before.",
		parameters: ReviewVerdictSchema,
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const p = params as ReviewVerdictParams;
			const { summary } = verdictHandler(ctx.sessionManager.getSessionId(), p);
			return {
				content: [{ type: "text", text: summary }],
				details: { todoId: p.todoId, verdict: p.verdict },
			};
		},
	};
}

/** Extension factory (mirrors `askUserQuestionExtension`): registers the tools on each session's `pi`. */
export function reviewToolExtension(pi: ExtensionAPI): void {
	pi.registerTool(createResolveCommentTool());
	pi.registerTool(createAddReviewCommentTool());
	pi.registerTool(createReviewVerdictTool());
}
