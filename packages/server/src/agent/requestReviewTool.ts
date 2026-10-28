import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { PlanReviewResult } from "@thinkrail/contracts";
import { type Static, Type } from "typebox";

export const REQUEST_REVIEW_TOOL_NAME = "request_review";

export const RequestReviewSchema = Type.Object({
	itemId: Type.String({
		description: "The plan item id (todo id) whose completed change set should be reviewed.",
	}),
});

export type RequestReviewParams = Static<typeof RequestReviewSchema>;

const DESCRIPTION = `Request an independent review of a completed plan step's change set — the commits or file changes the host attached to that step. Spawns a review subagent that inspects the step's commits/files and returns a structured verdict — "approve" or "request_changes" with inline findings. Call this right after you mark a step done when that step changed files; a step that changed none (running checks, opening a PR, replying to a comment) has no change set, and the tool refuses it. Then do exactly what the tool result's next action says — it encodes the current review policy: it may tell you to fix the findings and request_review again, or to stop and report them to the user. The reviewer is read-only; it never edits your files.`;

const PROMPT_GUIDELINES = [
	"After you mark a plan step done that changed files, call request_review with that step's id: an independent review subagent inspects its change set and returns a verdict.",
	"Skip request_review for a step that changed no files — running checks, opening a PR, replying to a comment: it has no change set, so there is nothing to review and the tool refuses it.",
	"Then follow the next action stated in the tool result verbatim — it encodes the configured review policy. When it says to fix, do so immediately and autonomously (set the step back to in_progress, apply every fix, mark done, re-review) — never ask the user for permission or report findings when the result tells you to fix. When it says to stop and report, do that instead.",
	"This is how plan steps get reviewed — the user does not trigger review manually.",
];

export interface RequestReviewOutcome {
	result: PlanReviewResult;
	/** The worker-facing text the tool returns — composed host-side so it can honor reviewAutoFix. */
	text: string;
}

export type RequestReviewHandler = (
	sessionId: string,
	itemId: string,
	signal: AbortSignal | undefined,
) => Promise<RequestReviewOutcome>;

let handler: RequestReviewHandler = () => {
	throw new Error("Plan-step review is not available on this host.");
};

export function setRequestReviewHandler(fn: RequestReviewHandler): void {
	handler = fn;
}

export function createRequestReviewTool(): ToolDefinition<
	typeof RequestReviewSchema,
	PlanReviewResult
> {
	return {
		name: REQUEST_REVIEW_TOOL_NAME,
		label: "Request Review",
		description: DESCRIPTION,
		promptGuidelines: PROMPT_GUIDELINES,
		parameters: RequestReviewSchema,
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const { itemId } = params as RequestReviewParams;
			const { result, text } = await handler(ctx.sessionManager.getSessionId(), itemId, signal);
			return { content: [{ type: "text", text }], details: result };
		},
	};
}

export function requestReviewExtension(pi: ExtensionAPI): void {
	pi.registerTool(createRequestReviewTool());
}
