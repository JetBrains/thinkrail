import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { type Static, Type } from "typebox";

export const START_WORKSPACE_TOOL_NAME = "start_workspace";
export const WORKSPACE_STATUS_TOOL_NAME = "workspace_status";

export const StartWorkspaceSchema = Type.Object({
	prompt: Type.String({
		description:
			"The complete, self-contained task for the new workspace's agent — it sees nothing of this conversation. May start with a prompt template or skill command, e.g. `/fix-issue 123`.",
	}),
	project: Type.Optional(
		Type.String({
			description:
				"Open ThinkRail project (name, slug, or id) to start the workspace in. Default: this chat's project.",
		}),
	),
	base_branch: Type.Optional(
		Type.String({
			description:
				"Branch or ref to cut the workspace from. Default: the project's default base branch, as in the New Workspace dialog.",
		}),
	),
	model: Type.Optional(
		Type.String({
			description: 'Model as "provider/id" or a unique id. Default: the app\'s new-chat model.',
		}),
	),
	effort: Type.Optional(
		Type.Union(
			[
				Type.Literal("off"),
				Type.Literal("minimal"),
				Type.Literal("low"),
				Type.Literal("medium"),
				Type.Literal("high"),
				Type.Literal("xhigh"),
				Type.Literal("max"),
			],
			{ description: "Thinking effort. Default: the app's new-chat effort." },
		),
	),
	attachments: Type.Optional(
		Type.Array(Type.String(), {
			description:
				"Files to hand over, as absolute paths or paths relative to this workspace. Images are attached to the prompt; other files are listed by absolute path.",
		}),
	),
});

export type StartWorkspaceParams = Static<typeof StartWorkspaceSchema>;

export const WorkspaceStatusSchema = Type.Object({
	project: Type.Optional(
		Type.String({
			description:
				"Open project (name, slug, or id) to overview. Default: this chat's project. Ignored when `workspaces` is given.",
		}),
	),
	workspaces: Type.Optional(
		Type.Array(Type.String(), {
			description:
				"Workspaces (id, name, or branch) to report in full, including each chat's final message. Searched across all open projects.",
		}),
	),
});

export type WorkspaceStatusParams = Static<typeof WorkspaceStatusSchema>;

export interface StartedWorkspace {
	workspaceId: string;
	projectId: string;
	sessionId: string;
	name: string;
	branch: string;
	baseBranch: string;
	model: string | null;
	effort: string;
}

export interface WorkspaceToolsHost {
	start: (callerSessionId: string, params: StartWorkspaceParams) => Promise<StartedWorkspace>;
	status: (callerSessionId: string, params: WorkspaceStatusParams) => Promise<string>;
}

const unavailableHost: WorkspaceToolsHost = {
	start: () => {
		throw new Error("Starting workspaces is not available on this host.");
	},
	status: () => {
		throw new Error("Workspace status is not available on this host.");
	},
};

let host: WorkspaceToolsHost = unavailableHost;

export function setWorkspaceToolsHost(next: WorkspaceToolsHost | null): void {
	host = next ?? unavailableHost;
}

const START_GUIDELINES = [
	"Use start_workspace whenever the user asks for work to happen in another, side, separate, new, or parallel workspace — or to run several tasks in parallel. Start one workspace per independent task; call it several times in one response to start them in parallel.",
	"When you notice that a request splits into independent tasks the user did not ask to parallelize, suggest starting them in separate workspaces instead of starting them unasked.",
	"The new workspace is an ordinary git worktree cut from a committed branch: commit (or attach) anything it needs from this workspace first. Its agent sees nothing of this conversation, so write a self-contained prompt with the goal, context, and what done looks like (e.g. whether to open a PR).",
	"start_workspace returns once the new chat has accepted its prompt, without waiting for its work; use workspace_status to see how started workspaces are doing.",
];

const STATUS_GUIDELINES = [
	"Use workspace_status to check on workspaces — ones you started or any other in an open project: chat states, final messages, PR state, and diff size. Without arguments it gives a compact overview of this project; name workspaces to read their chats' final messages.",
];

function startedText(started: StartedWorkspace): string {
	const model = started.model ? `${started.model}, effort ${started.effort}` : "default model";
	return `Started workspace "${started.name}" (id ${started.workspaceId}, branch ${started.branch}, from ${started.baseBranch}) with chat ${started.sessionId} on ${model}. It runs independently; check it with workspace_status.`;
}

export function createStartWorkspaceTool(): ToolDefinition<
	typeof StartWorkspaceSchema,
	StartedWorkspace
> {
	return {
		name: START_WORKSPACE_TOOL_NAME,
		label: "Start Workspace",
		description:
			"Start a new workspace (its own git worktree and branch) in an open project and launch its first chat with a task prompt. Returns immediately; the new chat runs on its own.",
		promptSnippet: "Start a new workspace with its own chat to work on a task in parallel",
		promptGuidelines: START_GUIDELINES,
		parameters: StartWorkspaceSchema,
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const started = await host.start(
				ctx.sessionManager.getSessionId(),
				params as StartWorkspaceParams,
			);
			return { content: [{ type: "text", text: startedText(started) }], details: started };
		},
	};
}

export function createWorkspaceStatusTool(): ToolDefinition<
	typeof WorkspaceStatusSchema,
	undefined
> {
	return {
		name: WORKSPACE_STATUS_TOOL_NAME,
		label: "Workspace Status",
		description:
			"Report workspaces' status: each chat's state (working, needs_you, finished, failed, interrupted, idle), PR state and link, and diff stats; named workspaces also include each chat's final message.",
		promptSnippet: "Check the status of workspaces and their chats",
		promptGuidelines: STATUS_GUIDELINES,
		parameters: WorkspaceStatusSchema,
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const text = await host.status(
				ctx.sessionManager.getSessionId(),
				params as WorkspaceStatusParams,
			);
			return { content: [{ type: "text", text }], details: undefined };
		},
	};
}

export function workspaceToolsExtension(pi: ExtensionAPI): void {
	pi.registerTool(createStartWorkspaceTool());
	pi.registerTool(createWorkspaceStatusTool());
}
