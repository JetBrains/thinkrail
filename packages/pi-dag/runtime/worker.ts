import type { ExtensionContext, ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { type Static, Type } from "typebox";
import { fail, LIMITS, SubmissionSchema } from "../domain";

export const WORKER_TOOLS = ["dag_submit_result", "dag_request_input"];
export const SubmitSchema = Type.Object(
	{ outputs: SubmissionSchema },
	{ additionalProperties: false },
);
export const InputSchema = Type.Object(
	{ question: Type.String({ minLength: 1, maxLength: LIMITS.valueBytes }) },
	{ additionalProperties: false },
);
export type Submission = Static<typeof SubmitSchema>;
export interface WorkerReceipt {
	dagId: string;
	id: string;
	kind: "proposal" | "input";
}
export interface WorkerProtocol {
	submit(
		sessionId: string,
		invocationId: string,
		args: Submission,
		signal: AbortSignal,
	): Promise<WorkerReceipt>;
	input(
		sessionId: string,
		invocationId: string,
		question: string,
		signal: AbortSignal,
	): Promise<WorkerReceipt>;
}

function singleCall(ctx: ExtensionContext, id: string, name: string): string {
	const entry = ctx.sessionManager
		.getBranch()
		.findLast((entry) => entry.type === "message" && entry.message.role === "assistant");
	if (entry?.type !== "message" || entry.message.role !== "assistant")
		fail("invalid-command", "Cannot identify the invoking worker batch");
	const calls = entry.message.content.filter((block) => block.type === "toolCall");
	if (calls.length !== 1 || calls[0]?.name !== name || calls[0].id !== id)
		fail("invalid-command", `${name} must be the sole tool call in its assistant batch`);
	return `${entry.id}:${id}`;
}

export function workerExtension(protocol: WorkerProtocol): ExtensionFactory {
	return (pi) => {
		pi.registerTool({
			name: "dag_submit_result",
			label: "Submit DAG result",
			description:
				"Submit exactly the declared outputs. Use {kind:'text',text}, {kind:'json',value}, or {kind:'artifact',path} for a workspace file. Must be the sole tool call in the batch. Durable submission requests activation end; pi settlement remains authoritative. It is not approval or acceptance.",
			parameters: SubmitSchema,
			async execute(id, args, signal, _update, ctx) {
				const invocation = singleCall(ctx, id, "dag_submit_result");
				const receipt = await protocol.submit(
					ctx.sessionManager.getSessionId(),
					invocation,
					args,
					signal ?? new AbortController().signal,
				);
				return {
					content: [{ type: "text", text: JSON.stringify(receipt) }],
					details: receipt,
					terminate: true,
				};
			},
		});
		pi.registerTool({
			name: "dag_request_input",
			label: "Request DAG input",
			description:
				"Ask for required input and end this activation. Must be the sole tool call in the batch. The runtime, not the worker, selects who may answer; do not approve gates yourself.",
			parameters: InputSchema,
			async execute(id, args, signal, _update, ctx) {
				const invocation = singleCall(ctx, id, "dag_request_input");
				const receipt = await protocol.input(
					ctx.sessionManager.getSessionId(),
					invocation,
					args.question,
					signal ?? new AbortController().signal,
				);
				return {
					content: [{ type: "text", text: JSON.stringify(receipt) }],
					details: receipt,
					terminate: true,
				};
			},
		});
	};
}
