import {
	type Container,
	EXTENSION_MESSAGE_CUSTOM_TYPE,
	type ExtensionMessageDetails,
	type OpenPrResult,
	type Project,
	type ThinkingLevel,
	type WireModel,
	type Workspace,
} from "@thinkrail/contracts";
import { CodedError } from "@thinkrail/shared/codedError";
import {
	abortSession,
	ensureSessionAttached,
	getSessionWorkspaceId,
	type HostMessageDelivery,
	hasSession,
	isSessionStreaming,
	listSessions,
	listSettledModels,
	sendHostMessageToSession,
} from "../agent";
import { type AssistAsk, assistText } from "../assist";
import { listContainers } from "../containers";
import type { ExtensionHostActions } from "../extensions";
import { serverExtensions } from "../extensions";
import { nonInteractiveGitEnv } from "../git";
import { listProjects } from "../projects";
import { getConfig } from "../settings";
import { type BoundedRun, runBounded } from "../subprocess";
import {
	createWorkspaceWithChat,
	type HandedOff,
	isChatsContainer,
	isChatWorkspace,
	listAllWorkspaceRecords,
} from "../workspaces";
import { ackSend } from "./ackSend";
import { openWorkspacePr } from "./orchestratorTools";
import { runObservation } from "./runAnalytics";
import { defaultBaseBranch, resolveModel } from "./workspaceTools";

const MESSAGE_ACK_MS = 3_000;
export const MAX_RUN_MS = 10 * 60_000;
export const MAX_ASSIST_PROMPT = 20_000;
export const MAX_ASSIST_TOKENS = 1_024;
const DEFAULT_ASSIST_TOKENS = 256;

const THINKING_LEVELS: readonly string[] = [
	"off",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
	"max",
] satisfies readonly ThinkingLevel[];

type CreationOptions = Parameters<typeof createWorkspaceWithChat>[1];

export interface ExtensionActionDeps {
	isDisabled: (extension: string) => boolean;
	title: (extension: string) => string;
	projects: () => Project[];
	containers: () => Container[];
	workspaces: () => Workspace[];
	settledModels: () => Promise<WireModel[]>;
	defaultBaseBranch: (projectId: string) => Promise<string>;
	create: (projectId: string, options: CreationOptions) => Promise<HandedOff>;
	/** The workspace holding a chat: its live attribution, else the workspace whose chats list it. */
	chatWorkspace: (sessionId: string) => Promise<Workspace | null>;
	attach: (sessionId: string, workspace: Workspace) => Promise<boolean>;
	send: (
		sessionId: string,
		content: string,
		details: ExtensionMessageDetails,
		deliverAs: HostMessageDelivery,
	) => Promise<void>;
	streaming: (sessionId: string) => boolean;
	abort: (sessionId: string) => Promise<void>;
	openPr: (
		workspace: Workspace,
		params: { title?: string; body?: string; draft?: boolean },
	) => Promise<OpenPrResult & { branch: string }>;
	run: (
		argv: string[],
		options: { timeoutMs: number; cwd: string; signal: AbortSignal },
	) => Promise<BoundedRun>;
	/** The one-shot assist path: the trimmed answer, `null` without a model or an answer. */
	assist: (ask: AssistAsk) => Promise<string | null>;
}

async function chatWorkspace(sessionId: string): Promise<Workspace | null> {
	const records = listAllWorkspaceRecords();
	const live = getSessionWorkspaceId(sessionId);
	if (live !== undefined) return records.find((workspace) => workspace.id === live) ?? null;
	for (const workspace of records) {
		const chats = await listSessions(workspace.id, workspace.worktreePath).catch(() => []);
		if (chats.some((chat) => chat.sessionId === sessionId)) return workspace;
	}
	return null;
}

export const liveActionDeps: ExtensionActionDeps = {
	isDisabled: (extension) => getConfig().disabledExtensions.includes(extension),
	title: (extension) =>
		serverExtensions.find((entry) => entry.extension.name === extension)?.extension.title ??
		extension,
	projects: listProjects,
	containers: listContainers,
	workspaces: listAllWorkspaceRecords,
	settledModels: listSettledModels,
	defaultBaseBranch: (projectId) => defaultBaseBranch(projectId),
	create: (projectId, options) => createWorkspaceWithChat(projectId, options),
	chatWorkspace,
	attach: async (sessionId, workspace) =>
		getSessionWorkspaceId(sessionId) === workspace.id ||
		(getSessionWorkspaceId(sessionId) === undefined &&
			(await ensureSessionAttached(sessionId, workspace.id, workspace.worktreePath))),
	send: (sessionId, content, details, deliverAs) =>
		ackSend(
			runObservation.send(sessionId, "internal", () =>
				sendHostMessageToSession(sessionId, EXTENSION_MESSAGE_CUSTOM_TYPE, content, details, {
					deliverAs,
				}),
			),
			MESSAGE_ACK_MS,
		),
	streaming: (sessionId) => hasSession(sessionId) && isSessionStreaming(sessionId),
	abort: async (sessionId) => {
		await abortSession(sessionId);
	},
	openPr: openWorkspacePr,
	run: (argv, options) => runBounded(argv, { ...options, env: nonInteractiveGitEnv() }),
	assist: assistText,
};

function requiredText(value: unknown, what: string): string {
	const text = typeof value === "string" ? value.trim() : "";
	if (!text) throw new Error(`Pass a non-empty ${what}.`);
	return text;
}

function optionalText(value: unknown, what: string): string | undefined {
	if (value === undefined) return undefined;
	if (typeof value !== "string") throw new Error(`${what} must be a string.`);
	return value.trim() || undefined;
}

export function extensionMessageContent(title: string, text: string): string {
	return `Message from the ThinkRail extension "${title}" (host automation, not the human):\n\n${text}`;
}

/**
 * One extension's named host actions, each refused while the extension is switched off; a run stops once
 * `signal` (its services') aborts.
 */
export function extensionActions(
	extension: string,
	signal: AbortSignal,
	deps: ExtensionActionDeps = liveActionDeps,
): ExtensionHostActions {
	const admit = (): void => {
		if (deps.isDisabled(extension))
			throw new CodedError("EXTENSION_DISABLED", `The ${extension} extension is switched off`);
	};
	const repositoryWorkspace = (workspaceId: unknown, what: string): Workspace => {
		const workspace = deps.workspaces().find((candidate) => candidate.id === workspaceId);
		if (!workspace) throw new Error(`Unknown workspace: ${String(workspaceId)}`);
		if (isChatWorkspace(workspace))
			throw new Error(`A chat without a project has no worktree to ${what}.`);
		return workspace;
	};
	return {
		async createWorkspace(params) {
			admit();
			const project = deps
				.projects()
				.find((candidate) => candidate.id === params.projectId && !isChatsContainer(candidate));
			if (!project) throw new Error(`No open repository project ${String(params.projectId)}.`);
			const text = requiredText(params.kickoff?.text, "kickoff text");
			const into = optionalText(params.into, "into");
			if (into !== undefined && !deps.containers().some((container) => container.id === into))
				throw new CodedError("CONTAINER_UNKNOWN", `Unknown container: ${into}`);
			const { thinkingLevel } = params.kickoff;
			if (thinkingLevel !== undefined && !THINKING_LEVELS.includes(thinkingLevel))
				throw new Error(`Unknown thinking level: ${String(thinkingLevel)}`);
			const modelRef = optionalText(params.kickoff.model, "model");
			const model = modelRef ? resolveModel(modelRef, await deps.settledModels()) : undefined;
			const name = optionalText(params.name, "name");
			const baseRef =
				optionalText(params.baseRef, "baseRef") ?? (await deps.defaultBaseBranch(project.id));
			const handed = await deps.create(project.id, {
				baseRef,
				kickoff: { text, ...(model ? { model } : {}), ...(thinkingLevel ? { thinkingLevel } : {}) },
				origin: "extension",
				...(name ? { name } : {}),
				...(into ? { into } : {}),
			});
			const { workspace, sessionId, kickoffError } = handed;
			if (!sessionId)
				throw new Error(
					`Workspace "${workspace.name}" (id ${workspace.id}) was created, but its chat could not start: ${kickoffError}`,
				);
			return {
				workspaceId: workspace.id,
				sessionId,
				branch: workspace.branch,
				...(kickoffError ? { kickoffError } : {}),
			};
		},
		async sendToChat(params) {
			admit();
			const text = requiredText(params.text, "text");
			if (params.mode !== "follow_up" && params.mode !== "steer")
				throw new Error(`Unknown mode: ${String(params.mode)}`);
			const workspace = await deps.chatWorkspace(params.sessionId);
			if (!workspace) throw new Error(`Unknown chat: ${String(params.sessionId)}`);
			if (!(await deps.attach(params.sessionId, workspace)))
				throw new Error(`The chat ${params.sessionId} could not be opened.`);
			const extensionTitle = deps.title(extension);
			const details: ExtensionMessageDetails = {
				extension,
				extensionTitle,
				mode: params.mode,
				text,
			};
			await deps.send(
				params.sessionId,
				extensionMessageContent(extensionTitle, text),
				details,
				params.mode === "steer" ? "steer" : "followUp",
			);
		},
		async stopChat(params) {
			admit();
			if (!deps.streaming(params.sessionId)) return { stopped: false };
			await deps.abort(params.sessionId);
			return { stopped: true };
		},
		async openPr(params) {
			admit();
			const workspace = repositoryWorkspace(params.workspaceId, "open a PR from");
			const { branch: _branch, ...result } = await deps.openPr(workspace, {
				...(params.title !== undefined ? { title: params.title } : {}),
				...(params.body !== undefined ? { body: params.body } : {}),
				...(params.draft ? { draft: true } : {}),
			});
			return result;
		},
		async runInWorkspace(params) {
			admit();
			const { argv, timeoutMs } = params;
			if (
				!Array.isArray(argv) ||
				argv.length === 0 ||
				!argv.every((arg) => typeof arg === "string") ||
				!argv[0]
			)
				throw new Error("Pass argv as a non-empty list of strings; it is never run by a shell.");
			if (typeof timeoutMs !== "number" || !Number.isFinite(timeoutMs) || timeoutMs <= 0)
				throw new Error("Pass a positive timeoutMs.");
			const workspace = repositoryWorkspace(params.workspaceId, "run in");
			const run = await deps.run([...argv], {
				timeoutMs: Math.min(timeoutMs, MAX_RUN_MS),
				cwd: workspace.worktreePath,
				signal,
			});
			return { ok: run.ok, out: run.out, err: run.err, timedOut: run.timedOut };
		},
		async assist(params) {
			admit();
			const prompt = requiredText(params.prompt, "prompt");
			if (prompt.length > MAX_ASSIST_PROMPT)
				throw new Error(`The prompt is longer than ${MAX_ASSIST_PROMPT} characters.`);
			const { maxTokens = DEFAULT_ASSIST_TOKENS } = params;
			if (
				typeof maxTokens !== "number" ||
				!Number.isInteger(maxTokens) ||
				maxTokens < 1 ||
				maxTokens > MAX_ASSIST_TOKENS
			)
				throw new Error(`Pass maxTokens as a whole number from 1 to ${MAX_ASSIST_TOKENS}.`);
			if (signal.aborted) return null;
			const text = await deps.assist({ prompt, maxTokens, signal });
			return text === null ? null : { text };
		},
	};
}
