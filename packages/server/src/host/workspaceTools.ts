import { readFileSync, statSync } from "node:fs";
import { extname, isAbsolute, resolve } from "node:path";
import type {
	ImageContent,
	Project,
	SessionState,
	SessionSummary,
	WireModel,
	Workspace,
	WorkspaceKickoff,
} from "@thinkrail/contracts";
import {
	getSessionWorkspaceId,
	listSessions,
	listSettledModels,
	readFinalAssistantTexts,
	type StartedWorkspace,
	type StartWorkspaceParams,
	type WorkspaceStatusParams,
	type WorkspaceToolsHost,
} from "../agent";
import { listBranches, prefetchBranch } from "../git";
import { logger } from "../log";
import { listProjects } from "../projects";
import {
	createWorkspaceWithChat,
	getWorkspace,
	type HandedOff,
	isChatsContainer,
	isChatWorkspace,
	listAllWorkspaceRecords,
	listWorkspaces,
	WorkspaceCreationStopped,
	workspaceDiffStats,
} from "../workspaces";
import { nudgeBaseRefWorkspaces } from "./fsNudge";

const log = logger("host");

export const FINAL_MESSAGE_LIMIT = 4000;

const IMAGE_MIME_TYPES: Record<string, string> = {
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".gif": "image/gif",
	".webp": "image/webp",
};

export const workspaceToolsHost: WorkspaceToolsHost = {
	start: (callerSessionId, params, signal) =>
		startWorkspace(callerSessionId, params, liveStartDeps, signal),
	status: (callerSessionId, params) => workspaceStatus(callerSessionId, params, liveStatusDeps),
};

function callerWorkspace(sessionId: string): Workspace {
	const workspaceId = getSessionWorkspaceId(sessionId);
	if (!workspaceId) throw new Error("Workspace tools are only available in a top-level chat.");
	return getWorkspace(workspaceId);
}

function ownProjectId(caller: Workspace): string | undefined {
	return isChatWorkspace(caller) ? undefined : caller.projectId;
}

function openRepositories(projects: readonly Project[] = listProjects()): Project[] {
	return projects.filter((project) => !isChatsContainer(project));
}

function describeProjects(projects: readonly Project[]): string {
	return projects.map((project) => `${project.name} (${project.slug})`).join(", ") || "none";
}

export function resolveProject(
	ref: string | undefined,
	fallbackProjectId: string | undefined,
	projects: readonly Project[] = listProjects(),
): Project {
	const open = openRepositories(projects);
	const needle = ref?.trim();
	if (!needle) {
		if (fallbackProjectId === undefined) {
			throw new Error(
				`This chat has no project: pass \`project\`. Open projects: ${describeProjects(open)}.`,
			);
		}
		const own = open.find((project) => project.id === fallbackProjectId);
		if (!own) throw new Error("This chat's project is not open.");
		return own;
	}
	const lower = needle.toLowerCase();
	const matches = open.filter(
		(project) =>
			project.id === needle ||
			project.slug.toLowerCase() === lower ||
			project.name.toLowerCase() === lower,
	);
	const [only] = matches;
	if (only && matches.length === 1) return only;
	throw new Error(
		`${matches.length > 1 ? "Ambiguous" : "Unknown"} project "${needle}". Open projects: ${describeProjects(open)}.`,
	);
}

export function resolveModel(ref: string, models: readonly WireModel[]): WireModel {
	const needle = ref.trim();
	const exact = models.find((model) => `${model.provider}/${model.id}` === needle);
	if (exact) return exact;
	const byId = models.filter((model) => model.id === needle);
	const [only] = byId;
	if (only && byId.length === 1) return only;
	const available = models.map((model) => `${model.provider}/${model.id}`).join(", ");
	throw new Error(
		`${byId.length > 1 ? "Ambiguous" : "Unknown"} model "${needle}". Available: ${available || "none"}.`,
	);
}

export interface PreparedAttachments {
	images: ImageContent[];
	files: string[];
}

export function prepareAttachments(paths: readonly string[], cwd: string): PreparedAttachments {
	const prepared: PreparedAttachments = { images: [], files: [] };
	for (const raw of paths) {
		const path = isAbsolute(raw) ? raw : resolve(cwd, raw);
		let isFile = false;
		try {
			isFile = statSync(path).isFile();
		} catch {
			isFile = false;
		}
		if (!isFile) throw new Error(`Attachment not found or not a file: ${path}`);
		const mimeType = IMAGE_MIME_TYPES[extname(path).toLowerCase()];
		if (mimeType) {
			prepared.images.push({
				type: "image",
				data: readFileSync(path).toString("base64"),
				mimeType,
			});
		} else {
			prepared.files.push(path);
		}
	}
	return prepared;
}

export function composePrompt(prompt: string, files: readonly string[]): string {
	if (files.length === 0) return prompt;
	return `${prompt}\n\nAttached files:\n${files.map((file) => `- ${file}`).join("\n")}`;
}

async function defaultBaseBranch(projectId: string, signal?: AbortSignal): Promise<string> {
	const { defaultBranch } = await listBranches(projectId);
	try {
		const { moved } = await prefetchBranch(projectId, defaultBranch, signal);
		if (moved) nudgeBaseRefWorkspaces(projectId, defaultBranch);
	} catch {
		log.warn(`start_workspace prefetch of ${defaultBranch} failed for project ${projectId}`);
	}
	return defaultBranch;
}

export interface StartWorkspaceDeps {
	callerWorkspace: (sessionId: string) => Workspace;
	openProjects: () => Project[];
	settledModels: () => Promise<WireModel[]>;
	defaultBaseBranch: (projectId: string, signal?: AbortSignal) => Promise<string>;
	create: (
		projectId: string,
		baseRef: string,
		kickoff: WorkspaceKickoff,
		signal?: AbortSignal,
	) => Promise<HandedOff>;
}

const liveStartDeps: StartWorkspaceDeps = {
	callerWorkspace,
	openProjects: listProjects,
	settledModels: listSettledModels,
	defaultBaseBranch,
	create: (projectId, baseRef, kickoff, signal) =>
		createWorkspaceWithChat(projectId, { baseRef, kickoff, origin: "agent" }, signal),
};

const NOTHING_CREATED = "Stopped; no workspace was created.";

export async function startWorkspace(
	callerSessionId: string,
	params: StartWorkspaceParams,
	deps: StartWorkspaceDeps,
	signal?: AbortSignal,
): Promise<StartedWorkspace> {
	const caller = deps.callerWorkspace(callerSessionId);
	const prompt = params.prompt.trim();
	if (!prompt) throw new Error("Pass a non-empty prompt.");
	const project = resolveProject(params.project, ownProjectId(caller), deps.openProjects());
	const model = params.model?.trim()
		? resolveModel(params.model, await deps.settledModels())
		: undefined;
	const { images, files } = prepareAttachments(params.attachments ?? [], caller.worktreePath);
	const baseRef = params.base_branch?.trim() || (await deps.defaultBaseBranch(project.id, signal));
	if (signal?.aborted) throw new Error(NOTHING_CREATED);
	const kickoff: WorkspaceKickoff = {
		text: composePrompt(prompt, files),
		...(images.length > 0 ? { images } : {}),
		...(model ? { model } : {}),
		...(params.effort ? { thinkingLevel: params.effort } : {}),
	};
	let handed: HandedOff;
	try {
		handed = await deps.create(project.id, baseRef, kickoff, signal);
	} catch (error) {
		if (error instanceof WorkspaceCreationStopped) throw new Error(NOTHING_CREATED);
		throw error;
	}
	const { workspace, sessionId, thinkingLevel, kickoffError } = handed;
	const named = `Workspace "${workspace.name}" (id ${workspace.id})`;
	if (!sessionId || !thinkingLevel) {
		throw new Error(`${named} was created, but its chat could not start: ${kickoffError}`);
	}
	if (kickoffError) {
		throw new Error(
			`${named} and its chat ${sessionId} were created, but the chat did not take its prompt: ${kickoffError}`,
		);
	}
	return {
		workspaceId: workspace.id,
		projectId: workspace.projectId,
		sessionId,
		name: workspace.name,
		branch: workspace.branch,
		baseBranch: workspace.baseBranch,
		model: handed.model ? `${handed.model.provider}/${handed.model.id}` : null,
		effort: thinkingLevel,
	};
}

export function chatStateLabel(state: SessionState | undefined): string {
	if (!state) return "idle";
	if (state.needsInput) return "needs_you";
	if (state.execution === "running" || state.backgroundWork) return "working";
	switch (state.completion?.outcome) {
		case "succeeded":
			return "finished";
		case "failed":
			return "failed";
		case "interrupted":
		case "cancelled":
			return "interrupted";
		default:
			return "idle";
	}
}

export function clampFinalMessage(text: string, limit = FINAL_MESSAGE_LIMIT): string {
	return text.length <= limit ? text : `…${text.slice(text.length - limit)}`;
}

export function chatName(summary: Pick<SessionSummary, "title" | "firstPrompt">): string {
	const title = summary.title.trim();
	if (title) return `"${title}"`;
	return summary.firstPrompt ? `unnamed, first prompt "${summary.firstPrompt}"` : "unnamed";
}

function prLine(workspace: Workspace): string {
	const review = workspace.review;
	if (!review) return "no PR";
	const label = review.kind === "merge-request" ? "MR" : "PR";
	const state = review.state ?? "open";
	return `${label} #${review.number} ${state}${review.url ? ` ${review.url}` : ""}`;
}

function diffLine(workspace: Workspace): string {
	const stats = workspace.diffStats;
	return stats ? `diff +${stats.added} -${stats.removed}` : "diff unknown";
}

export interface ChatReport {
	summary: SessionSummary;
	finalMessage?: string | null;
}

async function chatReports(workspace: Workspace, withFinal: boolean): Promise<ChatReport[]> {
	const summaries = await listSessions(workspace.id, workspace.worktreePath);
	if (!withFinal) return summaries.map((summary) => ({ summary }));
	const finals = await readFinalAssistantTexts(
		workspace.id,
		workspace.worktreePath,
		summaries.map((summary) => summary.sessionId),
	).catch(() => new Map<string, string | null>());
	return summaries.map((summary) => ({
		summary,
		finalMessage: finals.get(summary.sessionId) ?? null,
	}));
}

function renderWorkspace(
	workspace: Workspace,
	projectName: string,
	chats: ChatReport[] | Error,
	callerSessionId: string,
): string {
	const kind = workspace.kind === "default" ? ", default" : "";
	const lines = [
		`## ${workspace.name} — ${workspace.branch} (id ${workspace.id}, project ${projectName}${kind})`,
		`base ${workspace.baseBranch} · ${prLine(workspace)} · ${diffLine(workspace)}`,
	];
	if (chats instanceof Error) {
		lines.push(`chats unreadable: ${chats.message}`);
		return lines.join("\n");
	}
	if (chats.length === 0) lines.push("no chats");
	for (const { summary, finalMessage } of chats) {
		const self = summary.sessionId === callerSessionId ? ", this chat" : "";
		lines.push(
			`- chat ${chatName(summary)} (${summary.sessionId}${self}): ${chatStateLabel(summary.state)}`,
		);
		if (finalMessage === undefined) continue;
		lines.push(
			finalMessage
				? `  final message:\n${clampFinalMessage(finalMessage)
						.split("\n")
						.map((line) => `    ${line}`)
						.join("\n")}`
				: "  final message: none yet",
		);
	}
	return lines.join("\n");
}

export function matchWorkspaces(
	refs: readonly string[],
	candidates: readonly Workspace[],
): { matched: Workspace[]; missing: string[] } {
	const matched: Workspace[] = [];
	const missing: string[] = [];
	for (const raw of refs) {
		const ref = raw.trim();
		const lower = ref.toLowerCase();
		const hits = candidates.filter(
			(workspace) =>
				workspace.id === ref ||
				workspace.branch.toLowerCase() === lower ||
				workspace.name.toLowerCase() === lower,
		);
		if (hits.length === 0) missing.push(ref);
		for (const hit of hits) if (!matched.includes(hit)) matched.push(hit);
	}
	return { matched, missing };
}

async function withDiffStats(workspace: Workspace): Promise<Workspace> {
	try {
		return { ...workspace, diffStats: await workspaceDiffStats(workspace.id) };
	} catch {
		return workspace;
	}
}

export interface WorkspaceStatusDeps {
	callerWorkspace: (sessionId: string) => Workspace;
	openProjects: () => Project[];
	allWorkspaces: () => Workspace[];
	projectWorkspaces: (projectId: string) => Promise<Workspace[]>;
	withDiffStats: (workspace: Workspace) => Promise<Workspace>;
	chatReports: (workspace: Workspace, withFinal: boolean) => Promise<ChatReport[]>;
}

const liveStatusDeps: WorkspaceStatusDeps = {
	callerWorkspace,
	openProjects: listProjects,
	allWorkspaces: listAllWorkspaceRecords,
	projectWorkspaces: (projectId) => listWorkspaces(projectId, { includeDiffStats: true }),
	withDiffStats,
	chatReports,
};

export async function workspaceStatus(
	callerSessionId: string,
	params: WorkspaceStatusParams,
	deps: WorkspaceStatusDeps,
): Promise<string> {
	const caller = deps.callerWorkspace(callerSessionId);
	const open = openRepositories(deps.openProjects());
	const projectName = new Map(open.map((project) => [project.id, project.name]));
	const report = async (workspace: Workspace, withFinal: boolean): Promise<string> => {
		const chats = await deps
			.chatReports(workspace, withFinal)
			.catch((error: unknown) => (error instanceof Error ? error : new Error(String(error))));
		const name = projectName.get(workspace.projectId) ?? workspace.projectId;
		return renderWorkspace(workspace, name, chats, callerSessionId);
	};
	const refs = params.workspaces?.filter((ref) => ref.trim()) ?? [];

	if (refs.length > 0) {
		const candidates = deps
			.allWorkspaces()
			.filter((workspace) => projectName.has(workspace.projectId));
		const { matched, missing } = matchWorkspaces(refs, candidates);
		const reports = await Promise.all(
			matched.map(async (workspace) => report(await deps.withDiffStats(workspace), true)),
		);
		if (missing.length > 0) reports.unshift(`No workspace matches: ${missing.join(", ")}.`);
		return reports.join("\n\n");
	}

	const project = resolveProject(params.project, ownProjectId(caller), open);
	const workspaces = await deps.projectWorkspaces(project.id);
	const reports = await Promise.all(workspaces.map((workspace) => report(workspace, false)));
	return [`# ${project.name}: ${workspaces.length} workspace(s)`, ...reports].join("\n\n");
}
