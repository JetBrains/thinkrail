import type {
	ExtensionFactory,
	ExtensionToolContext,
	ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { type Static, Type } from "typebox";
import { isOrchestratorWorkspace } from "./orchestratorPolicy";
import { selectForToolCall } from "./webUiContext";
import { StartWorkspaceSchema } from "./workspaceTools";

export const MESSAGE_CHAT_TOOL_NAME = "message_chat";
export const STOP_CHAT_TOOL_NAME = "stop_chat";
export const ADD_WORKSPACE_TOOL_NAME = "add_workspace";
export const REMOVE_WORKSPACE_TOOL_NAME = "remove_workspace";
export const OPEN_PR_TOOL_NAME = "open_pr";
export const MERGE_PR_TOOL_NAME = "merge_pr";

export const ORCHESTRATOR_TOOL_NAMES = [
	MESSAGE_CHAT_TOOL_NAME,
	STOP_CHAT_TOOL_NAME,
	ADD_WORKSPACE_TOOL_NAME,
	REMOVE_WORKSPACE_TOOL_NAME,
	OPEN_PR_TOOL_NAME,
	MERGE_PR_TOOL_NAME,
] as const;

const MEMBER = Type.String({
	description: "The member workspace of your container: its id, name, or branch.",
});
const MEMBER_CHAT = Type.Optional(
	Type.String({ description: "The member's chat (session id). Default: its most recent chat." }),
);

export const MessageChatSchema = Type.Object({
	workspace: MEMBER,
	session: MEMBER_CHAT,
	text: Type.String({
		description:
			"The message for the member's agent. It sees nothing of your conversation, so make it self-contained.",
	}),
	mode: Type.Optional(
		Type.Union([Type.Literal("follow_up"), Type.Literal("steer")], {
			description:
				"follow_up (default) waits for the chat's running turn to end; steer redirects a running turn at its next step. Either starts a turn in an idle chat.",
		}),
	),
});
export type MessageChatParams = Static<typeof MessageChatSchema>;

export const StopChatSchema = Type.Object({
	workspace: MEMBER,
	session: Type.Optional(
		Type.String({
			description:
				"The member's chat (session id) to stop. Default: every chat of it that is working.",
		}),
	),
});
export type StopChatParams = Static<typeof StopChatSchema>;

const start = StartWorkspaceSchema.properties;

export const AddWorkspaceSchema = Type.Object({
	prompt: Type.Optional(
		Type.String({
			description:
				"The complete, self-contained task for the new member's agent. Required unless you pass `attach`.",
		}),
	),
	project: Type.Optional(
		Type.String({
			description:
				"Open project (name, slug, or id) for the new member. Default: the project of the sibling named in `base`; required otherwise.",
		}),
	),
	base: Type.Optional(
		Type.String({
			description:
				"What to cut the new member from: a sibling member (id, name, or branch) to stack on its branch, or a branch or ref of the project. Default: the project's default base branch.",
		}),
	),
	model: start.model,
	effort: start.effort,
	attachments: start.attachments,
	attach: Type.Optional(
		Type.String({
			description:
				"Instead of starting a new workspace, add this existing standalone workspace (id, name, or branch) to the container.",
		}),
	),
});
export type AddWorkspaceParams = Static<typeof AddWorkspaceSchema>;

export const RemoveWorkspaceSchema = Type.Object({
	workspace: MEMBER,
	archive: Type.Optional(
		Type.Boolean({
			description:
				"Also archive the workspace. Refused unless its PR is merged; without it the workspace stays as a standalone workspace.",
		}),
	),
});
export type RemoveWorkspaceParams = Static<typeof RemoveWorkspaceSchema>;

export const OpenPrSchema = Type.Object({
	workspace: MEMBER,
	title: Type.Optional(Type.String({ description: "PR title. Default: the branch name." })),
	body: Type.Optional(
		Type.String({ description: "PR description. Default: the host's generated body." }),
	),
	draft: Type.Optional(Type.Boolean({ description: "Open it as a draft." })),
});
export type OpenPrToolParams = Static<typeof OpenPrSchema>;

export const MergePrSchema = Type.Object({
	workspace: MEMBER,
	method: Type.Optional(
		Type.Union([Type.Literal("squash"), Type.Literal("merge"), Type.Literal("rebase")], {
			description: "Merge method. Default: squash.",
		}),
	),
});
export type MergePrToolParams = Static<typeof MergePrSchema>;

/** The human's answer to a merge confirmation card; an agent can never give it. */
export type MergeVerdict = "approved" | "denied" | "unanswered";
export type MergeApproval = (question: string) => Promise<MergeVerdict>;

export interface OrchestratorToolsHost {
	messageChat(callerSessionId: string, params: MessageChatParams): Promise<string>;
	stopChat(callerSessionId: string, params: StopChatParams): Promise<string>;
	addWorkspace(
		callerSessionId: string,
		params: AddWorkspaceParams,
		signal?: AbortSignal,
	): Promise<string>;
	removeWorkspace(callerSessionId: string, params: RemoveWorkspaceParams): Promise<string>;
	openPr(callerSessionId: string, params: OpenPrToolParams): Promise<string>;
	mergePr(
		callerSessionId: string,
		params: MergePrToolParams,
		approve: MergeApproval,
	): Promise<string>;
}

const unavailable = (): never => {
	throw new Error("Container tools are not available on this host.");
};

const unavailableHost: OrchestratorToolsHost = {
	messageChat: unavailable,
	stopChat: unavailable,
	addWorkspace: unavailable,
	removeWorkspace: unavailable,
	openPr: unavailable,
	mergePr: unavailable,
};

let host: OrchestratorToolsHost = unavailableHost;

export function setOrchestratorToolsHost(next: OrchestratorToolsHost | null): void {
	host = next ?? unavailableHost;
}

export const MERGE_DENY = "Don't merge";
export const MERGE_APPROVE = "Merge";
export const MERGE_APPROVAL_TIMEOUT_MS = 15 * 60_000;

export interface OrchestratorToolOptions {
	approvalTimeoutMs?: number;
}

function text(value: string) {
	return { content: [{ type: "text" as const, text: value }], details: undefined };
}

function callerOf(ctx: ExtensionToolContext): string {
	return ctx.sessionManager.getSessionId();
}

export function createMessageChatTool(): ToolDefinition<typeof MessageChatSchema, undefined> {
	return {
		name: MESSAGE_CHAT_TOOL_NAME,
		label: "Message Chat",
		description:
			"Send a message to a member workspace's chat in your container, as the orchestrator (the chat shows it came from you, not the human).",
		promptSnippet: "Send a member workspace's chat a message (follow-up or steer)",
		promptGuidelines: [
			"Use message_chat to delegate work to a member or correct it: the member's agent makes code changes, you never do. Prefer follow_up; steer only to redirect a turn that is going wrong.",
		],
		parameters: MessageChatSchema,
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			return text(await host.messageChat(callerOf(ctx), params as MessageChatParams));
		},
	};
}

export function createStopChatTool(): ToolDefinition<typeof StopChatSchema, undefined> {
	return {
		name: STOP_CHAT_TOOL_NAME,
		label: "Stop Chat",
		description: "Stop the running turn of a member workspace's chat in your container.",
		promptSnippet: "Stop a member workspace's running chat",
		promptGuidelines: [
			"Use stop_chat when a member's chat must not continue (wrong direction, superseded work); message it afterwards to say what to do instead.",
		],
		parameters: StopChatSchema,
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			return text(await host.stopChat(callerOf(ctx), params as StopChatParams));
		},
	};
}

export function createAddWorkspaceTool(): ToolDefinition<typeof AddWorkspaceSchema, undefined> {
	return {
		name: ADD_WORKSPACE_TOOL_NAME,
		label: "Add Workspace",
		description:
			"Add a member to your container: start a new workspace (its own worktree, branch and first chat) from the project's base, stacked on a sibling member's branch, or in another project — or attach an existing standalone workspace.",
		promptSnippet: "Add a member workspace to this container (new, stacked, or attached)",
		promptGuidelines: [
			"Use add_workspace for every new member of this container (start_workspace makes a workspace outside it). Stack dependent work on a sibling with `base`, so its PR targets the sibling's branch.",
		],
		parameters: AddWorkspaceSchema,
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			return text(await host.addWorkspace(callerOf(ctx), params as AddWorkspaceParams, signal));
		},
	};
}

export function createRemoveWorkspaceTool(): ToolDefinition<
	typeof RemoveWorkspaceSchema,
	undefined
> {
	return {
		name: REMOVE_WORKSPACE_TOOL_NAME,
		label: "Remove Workspace",
		description:
			"Take a member out of your container; it stays a standalone workspace. With `archive`, also archive it, which is refused unless its PR is merged.",
		promptSnippet: "Take a member workspace out of this container",
		parameters: RemoveWorkspaceSchema,
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			return text(await host.removeWorkspace(callerOf(ctx), params as RemoveWorkspaceParams));
		},
	};
}

export function createOpenPrTool(): ToolDefinition<typeof OpenPrSchema, undefined> {
	return {
		name: OPEN_PR_TOOL_NAME,
		label: "Open PR",
		description:
			"Push a member workspace's branch and open (or update) its pull request against its base branch, as the PR panel does.",
		promptSnippet: "Open a member workspace's pull request",
		parameters: OpenPrSchema,
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			return text(await host.openPr(callerOf(ctx), params as OpenPrToolParams));
		},
	};
}

function humanApproval(
	sessionId: string,
	toolCallId: string,
	input: Record<string, unknown>,
	signal: AbortSignal | undefined,
	hasUI: boolean,
	timeoutMs: number,
): MergeApproval {
	return async (question) => {
		if (!hasUI) return "unanswered";
		const answer = await selectForToolCall(
			sessionId,
			{ toolCallId, toolInput: input },
			question,
			[MERGE_DENY, MERGE_APPROVE],
			{ ...(signal ? { signal } : {}), timeout: timeoutMs },
		);
		if (answer === MERGE_APPROVE) return "approved";
		return answer === MERGE_DENY ? "denied" : "unanswered";
	};
}

export function createMergePrTool(
	options: OrchestratorToolOptions = {},
): ToolDefinition<typeof MergePrSchema, undefined> {
	const timeoutMs = options.approvalTimeoutMs ?? MERGE_APPROVAL_TIMEOUT_MS;
	return {
		name: MERGE_PR_TOOL_NAME,
		label: "Merge PR",
		description:
			"Merge a member workspace's open pull request. The human is asked in this chat with a confirmation card first; it merges only when they approve.",
		promptSnippet: "Merge a member's pull request after the human approves it in this chat",
		promptGuidelines: [
			"Call merge_pr only when the human asked for the merge or it is the agreed next step; it waits for the human's answer on its card. A denial or no answer means do not merge: never retry it unasked.",
		],
		parameters: MergePrSchema,
		async execute(toolCallId, params, signal, _onUpdate, ctx) {
			const sessionId = callerOf(ctx);
			const approve = humanApproval(
				sessionId,
				toolCallId,
				{ ...params },
				signal,
				ctx.hasUI,
				timeoutMs,
			);
			return text(await host.mergePr(sessionId, params as MergePrToolParams, approve));
		},
	};
}

/** The container tools, registered only in an orchestrator's own sessions. */
export function orchestratorTools(
	workspaceId: string,
	options: OrchestratorToolOptions = {},
): ExtensionFactory {
	return (pi) => {
		if (!isOrchestratorWorkspace(workspaceId)) return;
		pi.registerTool(createMessageChatTool());
		pi.registerTool(createStopChatTool());
		pi.registerTool(createAddWorkspaceTool());
		pi.registerTool(createRemoveWorkspaceTool());
		pi.registerTool(createOpenPrTool());
		pi.registerTool(createMergePrTool(options));
	};
}
