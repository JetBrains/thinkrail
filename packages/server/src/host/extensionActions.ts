import { lstatSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	type Container,
	type ContainerOrchestrator,
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
	promptSession,
	sendHostMessageToSession,
} from "../agent";
import { type AssistAsk, assistText } from "../assist";
import { listContainers } from "../containers";
import type {
	ExtensionAddedReviewComment,
	ExtensionConformanceRequirement,
	ExtensionConformanceResult,
	ExtensionContainer,
	ExtensionHostActions,
	ExtensionReviewCommentInput,
} from "../extensions";
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
	orchestratorChat,
} from "../workspaces";
import { ackSend } from "./ackSend";
import { awaitKickoff, startChatSession } from "./chatSession";
import { fileExtensionComments, runConformanceReview } from "./conformanceReview";
import { createContainerOrchestrated, startContainerOrchestrator } from "./orchestrator";
import { openWorkspacePr } from "./orchestratorTools";
import { type ExtensionWake, wakeOrchestratorFromExtension } from "./orchestratorWakeups";
import { runObservation } from "./runAnalytics";
import { defaultBaseBranch, resolveModel } from "./workspaceTools";

const MESSAGE_ACK_MS = 3_000;
export const MAX_RUN_MS = 10 * 60_000;
export const MAX_ASSIST_PROMPT = 20_000;
export const MAX_ASSIST_TOKENS = 1_024;
export const MAX_WORKSPACE_FILE_BYTES = 1024 * 1024;
const MAX_WORKSPACE_PATH = 400;
const DEFAULT_ASSIST_TOKENS = 256;
export const MAX_WAKE_TEXT = 20_000;
const WAKE_KIND = /^[a-z][a-z0-9-]{0,39}$/;
const MAX_CONTAINER_MEMBERS = 100;
export const MAX_REQUIREMENTS = 200;
const MAX_REQUIREMENT_ID = 200;
const MAX_REQUIREMENT_TEXT = 4_000;
const MAX_SCENARIOS = 20;
const MAX_REVIEW_CONTEXT = 20_000;
export const MAX_REVIEW_COMMENTS = 100;
const MAX_COMMENT_TEXT = 4_000;
const MAX_AUTHOR = 40;

/** Workspaces a conformance review runs for now: one at a time each, whichever extension asked. */
const reviewingConformance = new Set<string>();

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

export interface ChatKickoff {
	text: string;
	model?: WireModel;
	thinkingLevel?: ThinkingLevel;
}

export interface ExtensionActionDeps {
	isDisabled: (extension: string) => boolean;
	title: (extension: string) => string;
	projects: () => Project[];
	containers: () => Container[];
	workspaces: () => Workspace[];
	settledModels: () => Promise<WireModel[]>;
	defaultBaseBranch: (projectId: string) => Promise<string>;
	create: (projectId: string, options: CreationOptions) => Promise<HandedOff>;
	/** A new chat in the workspace, sent `kickoff` as internal work: its id and the send's failure, if any. */
	startChat: (
		workspace: Workspace,
		kickoff: ChatKickoff,
	) => Promise<{ sessionId: string; kickoffError?: string }>;
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
	/** `container.create`: two or more members get their orchestrator. */
	createContainer: (params: { name?: string; workspaceIds: string[] }) => Container;
	startOrchestrator: (containerId: string) => Promise<ContainerOrchestrator>;
	orchestratorChat: (containerId: string) => Workspace | null;
	/** Joins the running host's wake-up coalescing; `false` when the container has no orchestrator. */
	wake: (containerId: string, wake: ExtensionWake) => boolean;
	/** The workspace's most recently updated chat, `null` without one. */
	latestChat: (workspace: Workspace) => Promise<string | null>;
	/** Plan review's hidden reviewer child with the conformance role, under a live chat. */
	reviewConformance: (input: {
		workspace: Workspace;
		sessionId: string;
		requirements: ExtensionConformanceRequirement[];
		context: string;
		signal: AbortSignal;
	}) => Promise<ExtensionConformanceResult>;
	/** Files the remarks in the workspace's Review as agent comments under `author`, all or nothing. */
	addReviewComments: (
		workspaceId: string,
		author: string,
		comments: ExtensionReviewCommentInput[],
	) => Promise<ExtensionAddedReviewComment[]>;
}

/** A container as extensions see it: the record with its orchestrator chat, once both are there. */
export function extensionContainer(
	container: Container,
	chat: Workspace | null,
): ExtensionContainer {
	return {
		id: container.id,
		name: container.name,
		workspaceIds: [...container.workspaceIds],
		orchestrator:
			chat && container.orchestratorSessionId
				? {
						projectId: chat.projectId,
						workspaceId: chat.id,
						sessionId: container.orchestratorSessionId,
					}
				: null,
	};
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
	startChat: async (workspace, { text, model, thinkingLevel }) => {
		const { sessionId } = await startChatSession(workspace, {
			...(model ? { model } : {}),
			...(thinkingLevel ? { thinkingLevel } : {}),
		});
		const kickoffError = await awaitKickoff((onPreflight) =>
			ackSend(
				runObservation.send(sessionId, "internal", () =>
					promptSession(sessionId, text, undefined, { onPreflight }),
				),
			),
		);
		return { sessionId, ...(kickoffError ? { kickoffError } : {}) };
	},
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
	createContainer: createContainerOrchestrated,
	startOrchestrator: (containerId) => startContainerOrchestrator(containerId),
	orchestratorChat,
	wake: wakeOrchestratorFromExtension,
	latestChat: async (workspace) => {
		const chats = await listSessions(workspace.id, workspace.worktreePath).catch(() => []);
		return (
			chats.reduce<{ sessionId: string; updatedAt: number } | null>(
				(latest, chat) => (!latest || chat.updatedAt > latest.updatedAt ? chat : latest),
				null,
			)?.sessionId ?? null
		);
	},
	reviewConformance: ({ workspace, sessionId, requirements, context, signal }) =>
		runConformanceReview({
			workspaceId: workspace.id,
			sessionId,
			worktreePath: workspace.worktreePath,
			baseBranch: workspace.baseBranch,
			requirements,
			context,
			signal,
		}),
	addReviewComments: fileExtensionComments,
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

/**
 * A worktree-relative file path an extension may write: `/`-separated segments, never absolute, never `.`,
 * `..` or empty, never under `.git`; answers the normalized path.
 */
export function workspaceFilePath(path: unknown): string {
	if (typeof path !== "string" || !path.trim()) throw new Error("Pass a non-empty relative path.");
	if (path.length > MAX_WORKSPACE_PATH)
		throw new Error(`The path is longer than ${MAX_WORKSPACE_PATH} characters.`);
	if (path.includes("\0")) throw new Error("The path holds a NUL character.");
	const unified = path.trim().replaceAll("\\", "/");
	if (unified.startsWith("/") || /^[A-Za-z]:/.test(unified))
		throw new Error(`${path} is absolute; pass a path relative to the worktree.`);
	const segments = unified.split("/");
	if (segments.some((segment) => segment === "" || segment === "." || segment === ".."))
		throw new Error(`${path} is not a plain relative path inside the worktree.`);
	if (segments.some((segment) => segment.toLowerCase() === ".git"))
		throw new Error(`${path} is under .git.`);
	return segments.join("/");
}

/**
 * Writes `content` at the relative `path` inside `worktree` atomically (a temp file, then a rename),
 * creating missing folders; refuses a symlink or a non-folder on the way and a target that is not a
 * regular file, so nothing lands outside the worktree.
 */
export function writeWorktreeFile(worktree: string, path: string, content: string): number {
	const segments = path.split("/");
	const name = segments.pop() ?? "";
	let dir = worktree;
	for (const segment of segments) {
		dir = join(dir, segment);
		const stat = lstatSync(dir, { throwIfNoEntry: false });
		if (!stat) mkdirSync(dir);
		else if (stat.isSymbolicLink() || !stat.isDirectory())
			throw new Error(`${path} passes through ${segment}, which is not a plain folder.`);
	}
	const target = join(dir, name);
	const existing = lstatSync(target, { throwIfNoEntry: false });
	if (existing && !existing.isFile()) throw new Error(`${path} exists and is not a regular file.`);
	const temporary = join(dir, `.${name}.${process.pid}-${Date.now()}.tmp`);
	try {
		writeFileSync(temporary, content, { flag: "wx" });
		renameSync(temporary, target);
	} catch (error) {
		rmSync(temporary, { force: true });
		throw error;
	}
	return Buffer.byteLength(content, "utf8");
}

function boundedText(value: unknown, what: string, max: number): string {
	const text = requiredText(value, what);
	if (text.length > max) throw new Error(`The ${what} is longer than ${max} characters.`);
	return text;
}

/** The requirements a conformance review checks: 1–200, unique ids, bounded text and scenarios. */
export function conformanceRequirements(value: unknown): ExtensionConformanceRequirement[] {
	if (!Array.isArray(value) || value.length === 0 || value.length > MAX_REQUIREMENTS)
		throw new Error(`Pass requirements as a list of 1 to ${MAX_REQUIREMENTS}.`);
	const seen = new Set<string>();
	return value.map((raw: unknown) => {
		const entry = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
		const id = boundedText(entry.id, "requirement id", MAX_REQUIREMENT_ID);
		if (seen.has(id)) throw new Error(`The requirement id ${id} is listed twice.`);
		seen.add(id);
		const text = boundedText(entry.text, "requirement text", MAX_REQUIREMENT_TEXT);
		const scenarios: unknown = entry.scenarios;
		if (scenarios === undefined) return { id, text };
		if (!Array.isArray(scenarios) || scenarios.length > MAX_SCENARIOS)
			throw new Error(`Pass a requirement's scenarios as a list of at most ${MAX_SCENARIOS}.`);
		return {
			id,
			text,
			scenarios: scenarios.map((scenario: unknown) =>
				boundedText(scenario, "scenario", MAX_REQUIREMENT_TEXT),
			),
		};
	});
}

/** Anchored remarks an extension files: 1–100, a relative path, a positive line, a side and text. */
export function reviewCommentInputs(value: unknown): ExtensionReviewCommentInput[] {
	if (!Array.isArray(value) || value.length === 0 || value.length > MAX_REVIEW_COMMENTS)
		throw new Error(`Pass comments as a list of 1 to ${MAX_REVIEW_COMMENTS}.`);
	return value.map((raw: unknown) => {
		const entry = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
		const path = workspaceFilePath(entry.path);
		const { line, side } = entry;
		if (typeof line !== "number" || !Number.isInteger(line) || line < 1)
			throw new Error("Pass each comment's line as a whole number from 1.");
		if (side !== "worktree" && side !== "base")
			throw new Error("Pass each comment's side as worktree or base.");
		return { path, line, side, text: boundedText(entry.text, "comment text", MAX_COMMENT_TEXT) };
	});
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
	const kickoffOf = async (
		kickoff: Parameters<ExtensionHostActions["startChat"]>[0]["kickoff"] | undefined,
	): Promise<ChatKickoff> => {
		const text = requiredText(kickoff?.text, "kickoff text");
		const thinkingLevel = kickoff?.thinkingLevel;
		if (thinkingLevel !== undefined && !THINKING_LEVELS.includes(thinkingLevel))
			throw new Error(`Unknown thinking level: ${String(thinkingLevel)}`);
		const modelRef = optionalText(kickoff?.model, "model");
		const model = modelRef ? resolveModel(modelRef, await deps.settledModels()) : undefined;
		return { text, ...(model ? { model } : {}), ...(thinkingLevel ? { thinkingLevel } : {}) };
	};
	return {
		async createWorkspace(params) {
			admit();
			const project = deps
				.projects()
				.find((candidate) => candidate.id === params.projectId && !isChatsContainer(candidate));
			if (!project) throw new Error(`No open repository project ${String(params.projectId)}.`);
			const kickoff = await kickoffOf(params.kickoff);
			const into = optionalText(params.into, "into");
			if (into !== undefined && !deps.containers().some((container) => container.id === into))
				throw new CodedError("CONTAINER_UNKNOWN", `Unknown container: ${into}`);
			const name = optionalText(params.name, "name");
			const baseRef =
				optionalText(params.baseRef, "baseRef") ?? (await deps.defaultBaseBranch(project.id));
			const handed = await deps.create(project.id, {
				baseRef,
				kickoff,
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
		async startChat(params) {
			admit();
			const workspace = deps.workspaces().find((candidate) => candidate.id === params.workspaceId);
			const project = workspace
				? deps.projects().find((candidate) => candidate.id === workspace.projectId)
				: undefined;
			if (!workspace || !project || isChatsContainer(project) || isChatWorkspace(workspace))
				throw new Error(`No open workspace ${String(params.workspaceId)} of a repository project.`);
			const started = await deps.startChat(workspace, await kickoffOf(params.kickoff));
			return {
				workspaceId: workspace.id,
				sessionId: started.sessionId,
				...(started.kickoffError ? { kickoffError: started.kickoffError } : {}),
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
		async writeWorkspaceFile(params) {
			admit();
			const workspace = repositoryWorkspace(params.workspaceId, "write in");
			const path = workspaceFilePath(params.path);
			if (typeof params.content !== "string") throw new Error("Pass the content as text.");
			if (Buffer.byteLength(params.content, "utf8") > MAX_WORKSPACE_FILE_BYTES)
				throw new CodedError(
					"FILE_TOO_LARGE",
					`The content is larger than ${MAX_WORKSPACE_FILE_BYTES} bytes.`,
				);
			const bytes = writeWorktreeFile(workspace.worktreePath, path, params.content);
			return { workspaceId: workspace.id, path, bytes };
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
		async createContainer(params) {
			admit();
			const ids: unknown = params?.workspaceIds;
			if (
				!Array.isArray(ids) ||
				ids.length === 0 ||
				ids.length > MAX_CONTAINER_MEMBERS ||
				!ids.every((id) => typeof id === "string" && id.trim() !== "")
			)
				throw new Error(
					`Pass workspaceIds as a list of 1 to ${MAX_CONTAINER_MEMBERS} workspace ids.`,
				);
			const name = optionalText(params.name, "name");
			const container = deps.createContainer({
				...(name ? { name } : {}),
				workspaceIds: ids.map((id: string) => id.trim()),
			});
			return extensionContainer(container, deps.orchestratorChat(container.id));
		},
		async startOrchestrator(params) {
			admit();
			const containerId = requiredText(params?.containerId, "containerId");
			if (!deps.containers().some((container) => container.id === containerId))
				throw new CodedError("CONTAINER_UNKNOWN", `Unknown container: ${containerId}`);
			const started = await deps.startOrchestrator(containerId);
			return {
				containerId: started.container.id,
				projectId: started.workspace.projectId,
				workspaceId: started.workspace.id,
				sessionId: started.sessionId,
			};
		},
		async wakeOrchestrator(params) {
			admit();
			const containerId = requiredText(params?.containerId, "containerId");
			const kind = typeof params.kind === "string" ? params.kind : "";
			if (!WAKE_KIND.test(kind))
				throw new Error(
					"Pass a kind of 1 to 40 lowercase letters, digits or dashes, starting with a letter.",
				);
			const text = requiredText(params.text, "text");
			if (text.length > MAX_WAKE_TEXT)
				throw new Error(`The text is longer than ${MAX_WAKE_TEXT} characters.`);
			const container = deps.containers().find((candidate) => candidate.id === containerId);
			if (!container)
				throw new CodedError("CONTAINER_UNKNOWN", `Unknown container: ${containerId}`);
			const woken = deps.wake(containerId, {
				extension,
				extensionTitle: deps.title(extension),
				kind,
				text,
			});
			if (!woken)
				throw new Error(
					`The container ${container.name} has no orchestrator to wake; start it first.`,
				);
		},
		async reviewConformance(params) {
			admit();
			const workspace = repositoryWorkspace(params?.workspaceId, "review");
			const requirements = conformanceRequirements(params.requirements);
			if (params.context !== undefined && typeof params.context !== "string")
				throw new Error("Pass the context as text.");
			const context = (params.context ?? "").trim();
			if (context.length > MAX_REVIEW_CONTEXT)
				throw new Error(`The context is longer than ${MAX_REVIEW_CONTEXT} characters.`);
			const requested = optionalText(params.sessionId, "sessionId");
			if (reviewingConformance.has(workspace.id))
				throw new Error(`A conformance review is already running for ${workspace.name}.`);
			reviewingConformance.add(workspace.id);
			try {
				const sessionId = requested ?? (await deps.latestChat(workspace));
				if (!sessionId) throw new Error(`${workspace.name} has no chat to run the reviewer under.`);
				if (!(await deps.attach(sessionId, workspace)))
					throw new Error(`The chat ${sessionId} could not be opened.`);
				if (signal.aborted) throw new Error(`The ${extension} extension was switched off.`);
				return await deps.reviewConformance({
					workspace,
					sessionId,
					requirements,
					context,
					signal,
				});
			} finally {
				reviewingConformance.delete(workspace.id);
			}
		},
		async addReviewComments(params) {
			admit();
			const workspace = repositoryWorkspace(params?.workspaceId, "comment on");
			const comments = reviewCommentInputs(params.comments);
			const author =
				params.author === undefined
					? deps.title(extension)
					: boundedText(params.author, "author", MAX_AUTHOR);
			return { comments: await deps.addReviewComments(workspace.id, author, comments) };
		},
	};
}
