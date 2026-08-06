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

/** Extension factory (mirrors `askUserQuestionExtension`): registers the tool on each session's `pi`. */
export function reviewToolExtension(pi: ExtensionAPI): void {
	pi.registerTool(createResolveCommentTool());
}
