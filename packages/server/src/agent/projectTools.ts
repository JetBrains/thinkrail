import type {
	AgentToolResult,
	ExtensionAPI,
	ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { type Static, Type } from "typebox";
import { selectForToolCall } from "./webUiContext";

export const OPEN_PROJECT_TOOL_NAME = "open_project";
export const CLONE_CHOICE = "Clone";
export const DENY_CHOICE = "Deny";

export const OpenProjectSchema = Type.Object({
	repository: Type.String({
		description:
			"The repository to open: a Git URL (https://…, git@host:owner/repo), a GitHub owner/repo, or a folder on the host (absolute, ~/… or ./…).",
	}),
});

export type OpenProjectParams = Static<typeof OpenProjectSchema>;

export type OpenProjectOutcome = "open" | "opened" | "cloned";

export interface OpenedProject {
	projectId: string;
	name: string;
	slug: string;
	path: string;
	outcome: OpenProjectOutcome;
}

export interface ClonePlan {
	kind: "clone";
	url: string;
	parentPath: string;
	name: string;
	destination: string;
	notice: boolean;
}

export type OpenProjectPlan = { kind: "ready"; project: OpenedProject } | ClonePlan;

export type OpenProjectStage = "approval" | "cloning";

export type OpenProjectDetails =
	| (OpenedProject & { notice?: boolean })
	| { stage: OpenProjectStage; url: string; destination: string; notice: boolean };

export interface ProjectToolsHost {
	plan: (
		callerSessionId: string,
		params: OpenProjectParams,
		signal?: AbortSignal,
	) => Promise<OpenProjectPlan>;
	clone: (callerSessionId: string, plan: ClonePlan, signal?: AbortSignal) => Promise<OpenedProject>;
}

export type AskToClone = (
	sessionId: string,
	toolCallId: string,
	plan: ClonePlan,
	signal?: AbortSignal,
) => Promise<string | undefined>;

const unavailableHost: ProjectToolsHost = {
	plan: () => {
		throw new Error("Opening projects is not available on this host.");
	},
	clone: () => {
		throw new Error("Opening projects is not available on this host.");
	},
};

let host: ProjectToolsHost = unavailableHost;

export function setProjectToolsHost(next: ProjectToolsHost | null): void {
	host = next ?? unavailableHost;
}

const GUIDELINES = [
	"Use open_project when the user wants to work on a repository that is not an open ThinkRail project, before start_workspace — start_workspace only starts workspaces in open projects. Pass a Git URL, a GitHub owner/repo, or a host folder (absolute, ~/… or ./…).",
	"open_project is safe to repeat: a repository that is already a project (open, recent, or already cloned) is returned without cloning. A clone waits for the user's approval; if they deny it, do not try again unless they ask.",
];

export function cloneQuestion(plan: ClonePlan): string {
	const ask = `Clone ${plan.url} into ${plan.destination}?`;
	return plan.notice
		? `${ask} This is your default projects folder; you can change it in Settings › Workspaces › Projects folder.`
		: ask;
}

export const askToClone: AskToClone = (sessionId, toolCallId, plan, signal) =>
	selectForToolCall(
		sessionId,
		{ toolCallId, toolInput: { repository: plan.url, destination: plan.destination } },
		cloneQuestion(plan),
		[CLONE_CHOICE, DENY_CHOICE],
		signal ? { signal } : undefined,
	);

export function openedText(project: OpenedProject): string {
	const how =
		project.outcome === "cloned"
			? "Cloned and opened"
			: project.outcome === "opened"
				? "Opened"
				: "Already open:";
	return `${how} project "${project.name}" (slug ${project.slug}) at ${project.path}. Start work in it with start_workspace({ project: "${project.slug}" }).`;
}

function stageUpdate(
	plan: ClonePlan,
	stage: OpenProjectStage,
): AgentToolResult<OpenProjectDetails> {
	const text =
		stage === "approval"
			? `Waiting for the user to approve cloning ${plan.url} into ${plan.destination}.`
			: `Cloning ${plan.url} into ${plan.destination}.`;
	return {
		content: [{ type: "text", text }],
		details: { stage, url: plan.url, destination: plan.destination, notice: plan.notice },
	};
}

export function createOpenProjectTool(
	ask: AskToClone = askToClone,
): ToolDefinition<typeof OpenProjectSchema, OpenProjectDetails> {
	return {
		name: OPEN_PROJECT_TOOL_NAME,
		label: "Open Project",
		description:
			"Open a repository as a ThinkRail project and return it, so start_workspace can work in it: an already known project is returned as is, a host folder is opened, and a URL is cloned into the projects folder after the user approves.",
		promptSnippet: "Open or clone a repository as a ThinkRail project for start_workspace",
		promptGuidelines: GUIDELINES,
		parameters: OpenProjectSchema,
		async execute(toolCallId, params, signal, onUpdate, ctx) {
			const sessionId = ctx.sessionManager.getSessionId();
			const plan = await host.plan(sessionId, params as OpenProjectParams, signal);
			if (plan.kind === "ready") {
				return {
					content: [{ type: "text", text: openedText(plan.project) }],
					details: plan.project,
				};
			}
			onUpdate?.(stageUpdate(plan, "approval"));
			const answer = await ask(sessionId, toolCallId, plan, signal);
			if (signal?.aborted) throw new Error("Stopped; nothing was cloned.");
			if (answer !== CLONE_CHOICE) {
				throw new Error(
					`The user did not approve cloning ${plan.url}; nothing was cloned. Do not try again unless they ask.`,
				);
			}
			onUpdate?.(stageUpdate(plan, "cloning"));
			const project = await host.clone(sessionId, plan, signal);
			return {
				content: [{ type: "text", text: openedText(project) }],
				details: { ...project, notice: plan.notice },
			};
		},
	};
}

export function projectToolsExtension(pi: ExtensionAPI): void {
	pi.registerTool(createOpenProjectTool());
}
