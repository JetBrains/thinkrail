import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { CHAT_HANDOFF_SUMMARY_MAX_LENGTH } from "@thinkrail/contracts";
import { type Static, Type } from "typebox";

export const CONTINUE_IN_WORKSPACE_TOOL_NAME = "continue_in_workspace";

export const ContinueInWorkspaceSchema = Type.Object({
	summary: Type.String({
		description:
			"A short handoff for the new chat: what was asked, what was decided, what is still open, and anything the next agent must know. Markdown, a few paragraphs at most.",
	}),
});

export type ContinueInWorkspaceParams = Static<typeof ContinueInWorkspaceSchema>;

const DESCRIPTION =
	"Hand this conversation over to a new workspace in a project the user picked. Only works after ThinkRail asked you to continue in a workspace (a card in this chat): write the summary and call it once; the result names the workspace and chat that received it.";

const PROMPT_SNIPPET =
	"Continue this chat in a new workspace with a summary (only when ThinkRail asks you to)";

export interface ContinueToolHost {
	apply: (sessionId: string, summary: string) => Promise<string>;
}

const unavailableHost: ContinueToolHost = {
	apply: () => {
		throw new Error("Continue in workspace is not available on this host.");
	},
};

let host: ContinueToolHost = unavailableHost;

export function setContinueToolHost(next: ContinueToolHost | null): void {
	host = next ?? unavailableHost;
}

export function clampHandoffSummary(summary: string): string {
	const trimmed = summary.trim();
	return trimmed.length > CHAT_HANDOFF_SUMMARY_MAX_LENGTH
		? `${trimmed.slice(0, CHAT_HANDOFF_SUMMARY_MAX_LENGTH - 1)}…`
		: trimmed;
}

export function createContinueInWorkspaceTool(): ToolDefinition<
	typeof ContinueInWorkspaceSchema,
	ContinueInWorkspaceParams
> {
	return {
		name: CONTINUE_IN_WORKSPACE_TOOL_NAME,
		label: "Continue in workspace",
		description: DESCRIPTION,
		promptSnippet: PROMPT_SNIPPET,
		parameters: ContinueInWorkspaceSchema,
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const summary = clampHandoffSummary((params as ContinueInWorkspaceParams).summary);
			if (!summary) throw new Error("Pass a non-empty summary.");
			const text = await host.apply(ctx.sessionManager.getSessionId(), summary);
			return { content: [{ type: "text", text }], details: { summary } };
		},
	};
}

export function continueInWorkspaceExtension(pi: ExtensionAPI): void {
	pi.registerTool(createContinueInWorkspaceTool());
}
