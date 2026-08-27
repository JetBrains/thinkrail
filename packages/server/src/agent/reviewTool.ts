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

let handler: (sessionId: string, commentId: string, note?: string) => ResolveCommentOutcome =
	() => {
		throw new Error("Review comments are not available on this host.");
	};

export function setReviewCommentHandler(
	fn: (sessionId: string, commentId: string, note?: string) => ResolveCommentOutcome,
): void {
	handler = fn;
}

export function createResolveCommentTool(): ToolDefinition<typeof ResolveCommentSchema> {
	return {
		name: RESOLVE_COMMENT_TOOL_NAME,
		label: "Resolve Review Comment",
		description: DESCRIPTION,
		parameters: ResolveCommentSchema,
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const { commentId, note } = params as ResolveCommentParams;
			const outcome = handler(ctx.sessionManager.getSessionId(), commentId, note);
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

export const REFLECT_FINDING_TOOL_NAME = "reflect_finding";

export const ReflectFindingSchema = Type.Object({
	commentId: Type.String({
		description: 'The finding id from the reflection package (e.g. "rc_1a2b3c4d").',
	}),
	verdict: Type.Union([Type.Literal("kept"), Type.Literal("refuted")], {
		description:
			"kept = the finding holds up against the code; refuted = it does not (default to refuted when unsure).",
	}),
	confidence: Type.Union([Type.Literal("low"), Type.Literal("medium"), Type.Literal("high")], {
		description: "How sure you are of this verdict.",
	}),
	reason: Type.String({
		description:
			"One line of evidence: the line or behaviour that confirms or refutes the finding.",
	}),
});
export type ReflectFindingParams = Static<typeof ReflectFindingSchema>;

let reflectHandler: (sessionId: string, params: ReflectFindingParams) => { body: string } = () => {
	throw new Error("Reflection is not available on this host.");
};

export function setReflectFindingHandler(
	fn: (sessionId: string, params: ReflectFindingParams) => { body: string },
): void {
	reflectHandler = fn;
}

export function createReflectFindingTool(): ToolDefinition<typeof ReflectFindingSchema> {
	return {
		name: REFLECT_FINDING_TOOL_NAME,
		label: "Reflect On Finding",
		description:
			"Record your verdict on ONE finding you were asked to reflect on: kept (holds up) or refuted (does not). Reflection chats only — one call per finding id in the package, after you have checked it against the code.",
		parameters: ReflectFindingSchema,
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const p = params as ReflectFindingParams;
			reflectHandler(ctx.sessionManager.getSessionId(), p);
			return {
				content: [
					{ type: "text", text: `Reflection on ${p.commentId}: ${p.verdict} (${p.confidence}).` },
				],
				details: { commentId: p.commentId, verdict: p.verdict },
			};
		},
	};
}

export function reviewToolExtension(pi: ExtensionAPI): void {
	pi.registerTool(createResolveCommentTool());
	pi.registerTool(createAddReviewCommentTool());
	pi.registerTool(createReviewVerdictTool());
	pi.registerTool(createReflectFindingTool());
}
