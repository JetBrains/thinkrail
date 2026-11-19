import { readdir, readFile, stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import {
	chatState,
	type ExtensionEventPush,
	type HistoryScope,
	type Project,
	type Workspace,
} from "@thinkrail/contracts";
import { seedArtifactsDir } from "@thinkrail/shared/artifactsDir";
import { WORKSPACE_CONTEXT_DIR } from "@thinkrail/shared/paths";
import {
	delegationRootDir,
	getPiRuntimeGeneration,
	hasSession,
	isPiSessionId,
	listSessions,
	sessionCompletionOf,
} from "../agent";
import type {
	ExtensionArtifactsDir,
	ExtensionChatFacts,
	ExtensionHostProject,
	ExtensionHostServices,
	ExtensionMessageAnchor,
	ExtensionPublishScope,
	ExtensionSessionPlacement,
	ExtensionSessionView,
	ExtensionTreeFile,
	ExtensionTurnReceipt,
	ExtensionTurnTree,
	ExtensionWorkspaceFacts,
} from "../extensions";
import { gitAsync, nonInteractiveGitEnv, readBlobBytesAtAsync } from "../git";
import { locateEntry } from "../history";
import { logger } from "../log";
import { dataDir } from "../persistence";
import { listProjects } from "../projects";
import { getConfig } from "../settings";
import { todoCounts } from "../todos";
import { listTurns } from "../turns";
import {
	isChatWorkspace,
	listAllWorkspaceRecords,
	listWorkspaceRecords,
	workspaceDiffStats,
} from "../workspaces";
import { historyHiddenCwd } from "./chats";
import { extensionActions } from "./extensionActions";
import { createExtensionEventHub } from "./extensionEvents";
import { buildHistoryScope } from "./historyScope";

export const isExtensionDisabled = (name: string): boolean =>
	getConfig().disabledExtensions.includes(name);

/** The live host events: `server.ts` emits from inside its existing publishers, never a second one. */
export const extensionEvents = createExtensionEventHub({
	isDisabled: isExtensionDisabled,
	log: (name) => logger(`extension:${name}`),
});

type ExtensionEventPublisher = (push: ExtensionEventPush, scope: ExtensionPublishScope) => void;

let extensionEventPublisher: ExtensionEventPublisher | null = null;

export function setExtensionEventPublisher(publisher: ExtensionEventPublisher | null): void {
	extensionEventPublisher = publisher;
}

const EVENT_TYPE = /^[\w.:-]{1,100}$/;

function publishFor(extension: string): ExtensionHostServices["publish"] {
	return (type, payload, scope = {}) => {
		if (typeof type !== "string" || !EVENT_TYPE.test(type))
			throw new Error(`An extension event type is 1–100 word characters, dots or dashes: ${type}`);
		if (isExtensionDisabled(extension) || !extensionEventPublisher) return;
		extensionEventPublisher(
			{ extension, type, payload },
			{
				...(typeof scope.workspaceId === "string" ? { workspaceId: scope.workspaceId } : {}),
				...(typeof scope.projectId === "string" ? { projectId: scope.projectId } : {}),
			},
		);
	};
}

function strictlyInside(root: string, path: string): string | null {
	const rel = relative(root, path);
	if (rel === "" || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return null;
	return rel;
}

function hostProject(project: Project, workspaces: readonly Workspace[]): ExtensionHostProject {
	return {
		id: project.id,
		name: project.name,
		kind: project.kind === "chats" ? "chats" : "repository",
		workspaces: workspaces.map((workspace) => ({
			id: workspace.id,
			name: workspace.name,
			kind: workspace.kind ?? "worktree",
			branch: workspace.branch,
		})),
	};
}

function sessionScope(scope: HistoryScope): ExtensionSessionView {
	const projects = listProjects();
	const recordsByProject = new Map(projects.map((p) => [p.id, listWorkspaceRecords(p.id)]));
	const workspacesOf = (projectId: string) => recordsByProject.get(projectId) ?? [];
	const view = projects.map((project) => hostProject(project, workspacesOf(project.id)));
	if (scope.kind === "chat") return { projects: view, locate: () => null };

	const hidden = historyHiddenCwd(undefined);
	const { filter } = buildHistoryScope(scope, projects, workspacesOf);
	const byPath = new Map<string, Workspace>();
	for (const records of recordsByProject.values()) {
		for (const workspace of records) byPath.set(workspace.worktreePath, workspace);
	}
	const bySlug = new Map(
		projects.filter((project) => project.kind !== "chats").map((p) => [p.slug, p]),
	);
	const worktreesRoot = join(dataDir(), "worktrees");

	const removed = (cwd: string): ExtensionSessionPlacement | null => {
		const rel = strictlyInside(worktreesRoot, cwd);
		if (rel === null) return null;
		const [slug = "", ...folder] = rel.split(sep);
		const project = bySlug.get(slug);
		if (!project || folder.length === 0) return null;
		for (const path of byPath.keys()) if (strictlyInside(path, cwd) !== null) return null;
		return {
			projectId: project.id,
			workspaceId: null,
			workspaceName: folder.join("/"),
			workspace: "removed",
		};
	};

	const inScope = (projectId: string | null) =>
		scope.kind === "all" || (scope.kind === "project" && scope.projectId === projectId);

	return {
		projects: view,
		locate: (cwd) => {
			if (hidden(cwd)) return null;
			const open = byPath.get(cwd);
			if (open) {
				if (!filter(cwd, "")) return null;
				return {
					projectId: open.projectId,
					workspaceId: open.id,
					workspaceName: open.name,
					workspace: "open",
				};
			}
			const placement = removed(cwd) ?? {
				projectId: null,
				workspaceId: null,
				workspaceName: null,
				workspace: "none",
			};
			return inScope(placement.projectId) ? placement : null;
		},
	};
}

async function isDirectory(path: string): Promise<boolean> {
	return stat(path).then(
		(entry) => entry.isDirectory(),
		() => false,
	);
}

async function childTranscriptDirs(parentSessionId: string, cwd: string): Promise<string[]> {
	if (!isPiSessionId(parentSessionId)) return [];
	const root = delegationRootDir();
	const known = listAllWorkspaceRecords().filter((workspace) => workspace.worktreePath === cwd);
	const scopes =
		known.length > 0
			? known.map((workspace) => workspace.id)
			: await readdir(root).catch(() => [] as string[]);
	const candidates = scopes.map((scope) => join(root, scope, parentSessionId));
	const present = await Promise.all(candidates.map(isDirectory));
	return candidates.filter((_, index) => present[index]);
}

const sessionsRoot = () => join(getAgentDir(), "sessions");

export async function messageAnchor(
	sessionFile: string,
	entryId: string,
	root: string = sessionsRoot(),
): Promise<ExtensionMessageAnchor | null> {
	const file = resolve(sessionFile);
	if (!file.endsWith(".jsonl") || strictlyInside(resolve(root), file) === null) return null;
	const text = await readFile(file, "utf8").catch(() => null);
	return text === null ? null : locateEntry(text, entryId);
}

export async function modelContextWindow(provider: string, model: string): Promise<number | null> {
	try {
		const { runtime } = await getPiRuntimeGeneration();
		const window = runtime.getModel(provider, model)?.contextWindow;
		return typeof window === "number" && window > 0 ? window : null;
	} catch {
		return null;
	}
}

/** A session's turn receipts across the registered workspaces, oldest first; paths stay repo-relative. */
export async function turnReceipts(sessionId: string): Promise<ExtensionTurnReceipt[]> {
	return listAllWorkspaceRecords()
		.flatMap((workspace) => listTurns(workspace.id))
		.filter((turn) => turn.sessionId === sessionId)
		.sort((a, b) => a.startedAt - b.startedAt)
		.map((turn) => ({
			startedAt: turn.startedAt,
			settledAt: turn.settledAt,
			changes: turn.changes.map(({ path, status, added, removed }) => ({
				path,
				status,
				...(added !== undefined ? { added } : {}),
				...(removed !== undefined ? { removed } : {}),
			})),
		}));
}

const TREE_TIMEOUT_MS = 20_000;
const TREE_ENTRY = /^(\d{6}) (\w+) [0-9a-f]+ +(-|\d+)\t([\s\S]+)$/;

/** A tree's regular files (no links, no submodules) with their sizes, from `git ls-tree -r --long`. */
async function treeEntries(
	worktreePath: string,
	tree: string,
): Promise<{ path: string; size: number }[] | null> {
	const listed = await gitAsync(
		worktreePath,
		["ls-tree", "-r", "-z", "--long", "--end-of-options", tree],
		{ raw: true, env: { ...nonInteractiveGitEnv(), LC_ALL: "C" }, timeoutMs: TREE_TIMEOUT_MS },
	);
	if (!listed.ok) return null;
	const out: { path: string; size: number }[] = [];
	for (const record of listed.out.split("\0")) {
		const match = TREE_ENTRY.exec(record);
		if (!match) continue;
		const [, mode = "", type, size = "-", path = ""] = match;
		if (type !== "blob" || (mode !== "100644" && mode !== "100755")) continue;
		out.push({ path, size: size === "-" ? 0 : Number(size) });
	}
	return out;
}

/** The workspace as a session's receipt left it: its recorded head tree, read from the worktree's repository. */
export async function turnTree(
	sessionId: string,
	startedAt: number,
	limits: { files: number; bytes: number },
): Promise<ExtensionTurnTree | null> {
	for (const workspace of listAllWorkspaceRecords()) {
		const turn = listTurns(workspace.id).find(
			(candidate) => candidate.sessionId === sessionId && candidate.startedAt === startedAt,
		);
		if (!turn) continue;
		const entries = await treeEntries(workspace.worktreePath, turn.headTree);
		if (!entries) return null;
		const bytes = entries.reduce((sum, entry) => sum + entry.size, 0);
		if (entries.length > limits.files || bytes > limits.bytes)
			return { kind: "tooLarge", files: entries.length, bytes };
		const files: ExtensionTreeFile[] = [];
		for (const entry of entries) {
			const content = await readBlobBytesAtAsync(
				workspace.worktreePath,
				turn.headTree,
				entry.path,
				{
					timeoutMs: TREE_TIMEOUT_MS,
				},
			).catch(() => null);
			if (content === null) return null;
			files.push({ path: entry.path, bytes: content });
		}
		return { kind: "files", files };
	}
	return null;
}

/** An open workspace's artifacts folder, seeded (with its self-ignoring `.gitignore`) when missing. */
export async function ensureArtifactsDir(
	workspaceId: string,
): Promise<ExtensionArtifactsDir | null> {
	const workspace = listAllWorkspaceRecords().find((candidate) => candidate.id === workspaceId);
	if (!workspace) return null;
	try {
		return { dir: seedArtifactsDir(workspace.worktreePath), relative: `${WORKSPACE_CONTEXT_DIR}/` };
	} catch {
		return null;
	}
}

function chatPlan(workspaceId: string, sessionId: string): ExtensionChatFacts["plan"] {
	try {
		const counts = todoCounts({ workspaceId, sessionId });
		return counts.total > 0 ? counts : null;
	} catch {
		return null;
	}
}

/** An open workspace's review, diff and chats, from the records, git and the session states. */
export async function workspaceFacts(workspaceId: string): Promise<ExtensionWorkspaceFacts | null> {
	const workspace = listAllWorkspaceRecords().find((candidate) => candidate.id === workspaceId);
	if (!workspace) return null;
	const [diff, chats] = await Promise.all([
		isChatWorkspace(workspace)
			? null
			: workspaceDiffStats(workspace.id).then(
					({ added, removed }) => ({ added, removed }),
					() => null,
				),
		listSessions(workspace.id, workspace.worktreePath).catch(() => []),
	]);
	const { review } = workspace;
	return {
		id: workspace.id,
		projectId: workspace.projectId,
		name: workspace.name,
		branch: workspace.branch,
		baseBranch: workspace.baseBranch,
		kind: workspace.kind ?? "worktree",
		review: review
			? {
					kind: review.kind,
					number: review.number,
					state: review.state ?? "open",
					...(review.url ? { url: review.url } : {}),
				}
			: null,
		diff,
		chats: chats.map((chat) => ({
			sessionId: chat.sessionId,
			title: chat.title,
			state: chatState(chat.state),
			unread: chat.state?.completionUnread ?? false,
			plan: chatPlan(workspace.id, chat.sessionId),
			updatedAt: chat.updatedAt,
		})),
	};
}

export function extensionHostServices(name: string, signal: AbortSignal): ExtensionHostServices {
	return {
		dataDir: join(dataDir(), "extensions", name),
		log: logger(`extension:${name}`),
		signal,
		actions: extensionActions(name, signal),
		events: extensionEvents.bus(name, signal),
		publish: publishFor(name),
		workspaceFacts,
		sessionsRoot,
		sessionScope,
		childTranscriptDirs,
		sessionStatus: (sessionId) => ({
			live: hasSession(sessionId),
			completion: sessionCompletionOf(sessionId),
		}),
		messageAnchor: (sessionFile, entryId) => messageAnchor(sessionFile, entryId),
		contextWindow: modelContextWindow,
		turnReceipts,
		turnTree,
		ensureArtifactsDir,
	};
}
