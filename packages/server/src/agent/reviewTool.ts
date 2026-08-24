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

export interface ResolveCommentOutcome {
	resolvedBody: string;
}

let handler: (commentId: string, note?: string) => ResolveCommentOutcome = () => {
	throw new Error("Review comments are not available on this host.");
};

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

export function reviewToolExtension(pi: ExtensionAPI): void {
	pi.registerTool(createResolveCommentTool());
}
