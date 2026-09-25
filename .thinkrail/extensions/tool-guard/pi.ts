import type { PiExtensionFactory } from "@thinkrail/ext";
import type { GuardTool } from "./model";

export interface GuardCall {
	sessionId: string;
	cwd: string;
	tool: GuardTool;
	input: string;
}

export type Decide = (call: GuardCall) => { block: true; reason: string } | undefined;

const callInput = (toolName: string, input: Record<string, unknown>) => {
	if (toolName === "bash" && typeof input.command === "string")
		return { tool: "bash" as const, input: input.command };
	if (toolName === "write" && typeof input.path === "string")
		return { tool: "write" as const, input: input.path };
	if (toolName === "edit" && typeof input.path === "string")
		return { tool: "edit" as const, input: input.path };
	return undefined;
};

export const guardPi =
	(decide: Decide): PiExtensionFactory =>
	(pi) => {
		pi.on("tool_call", (event, ctx) => {
			const call = callInput(event.toolName, event.input);
			if (!call) return undefined;
			return decide({ ...call, cwd: ctx.cwd, sessionId: ctx.sessionManager.getSessionId() });
		});
	};
