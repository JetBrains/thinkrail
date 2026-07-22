import type {
	AppConfig,
	AskUserQuestionResult,
	ExtUiResponse,
	ImageContent,
	LoginReply,
	Project,
	ThinkingLevel,
	WireModel,
	Workspace,
} from "@thinkrail/contracts";
import {
	abortSession,
	answerQuestion,
	compactSession,
	createSession,
	followUpSession,
	getDefaultModel,
	getSessionCommands,
	getSessionMessages,
	getSessionStats,
	hasSession,
	listAvailableModels,
	listSessions,
	promptSession,
	removeSession,
	removeWorkspaceSessions,
	resolveExtUi,
	setSessionModel,
	setSessionThinkingLevel,
	steerSession,
} from "../agent";
import {
	cancelLogin,
	connectJbcentral,
	disconnectJbcentral,
	getProviderStatus,
	jbcentralLogin,
	logoutProvider,
	resolveLogin,
	setProviderApiKey,
	startLogin,
} from "../auth";
import { selectDirectory } from "../dialog";
import { readDir, readFile } from "../fs";
import { gitDiff, gitStatus, listBranches, prefetchBranch } from "../git";
import { githubAuthStatus, githubRefresh } from "../github";
import {
	closeProject,
	initProject,
	inspectProjectPath,
	listProjects,
	openProject,
} from "../projects";
import { updateConfig } from "../settings";
import { evictSpecIndex, projectHasSpecs, specGraph } from "../spec";
import {
	closeTerminal,
	closeWorkspaceTerminals,
	createTerminal,
	resizeTerminal,
	writeTerminal,
} from "../terminal";
import { ensureWatch, stopWatch } from "../watch";
import {
	createWorkspace,
	forgetWorkspace,
	getWorkspace,
	listWorkspaceRecords,
	listWorkspaces,
	reclaimWorktree,
	workspaceDiffStats,
} from "../workspaces";
import { ackSend } from "./ackSend";

type Handler = (params: unknown) => unknown | Promise<unknown>;

/** Host→wire fan-out for project registry membership (installed by `createServer`; silent in unit tests). */
type ProjectOpenedPublisher = (project: Project) => void;
type ProjectRemovedPublisher = (id: string) => void;
let publishProjectOpened: ProjectOpenedPublisher | null = null;
let publishProjectRemoved: ProjectRemovedPublisher | null = null;

/** Install (or clear with `null`) the sink that broadcasts `project.opened` after open/init. */
export function setProjectOpenedPublisher(fn: ProjectOpenedPublisher | null): void {
	publishProjectOpened = fn;
}

/** Install (or clear with `null`) the sink that broadcasts `project.removed` after a successful close. */
export function setProjectRemovedPublisher(fn: ProjectRemovedPublisher | null): void {
	publishProjectRemoved = fn;
}

/**
 * The slow half of archiving a workspace, run in the background after `workspace.remove` /
 * `project.remove` acks: tear down the workspace's sessions (abort a streaming turn, dispose, purge
 * on-disk transcripts) then reclaim the worktree (`git worktree remove`). Optional `repoPath` is required
 * when the project record was already dropped (project remove) — `reclaimWorktree` looks it up otherwise.
 * Sessions/terminals are down before the dir is deleted (terminals are killed synchronously in the
 * handler; sessions here, before the reclaim). Best-effort by contract — a failure is logged, never
 * thrown into the void (nothing awaits it).
 */
async function archiveTeardown(ws: Workspace, repoPath?: string): Promise<void> {
	try {
		await removeWorkspaceSessions(ws.id, ws.worktreePath);
		reclaimWorktree(ws, repoPath);
	} catch (error) {
		console.warn(`workspace archive teardown failed for ${ws.id}: ${error}`);
	}
}

const handlers: Record<string, Handler> = {
	"project.open": (params) => {
		const project = openProject((params as { path: string }).path);
		// Fan membership to every client (new row or re-open lastOpened bump). Projects stay channel-ignorant.
		publishProjectOpened?.(project);
		return project;
	},
	"project.inspect": (params) => inspectProjectPath((params as { path: string }).path),
	"project.init": (params) => {
		const project = initProject((params as { path: string }).path);
		publishProjectOpened?.(project);
		return project;
	},
	"project.list": () => listProjects(),
	// Lazy, per-project: the Welcome screen requests this only for the one project it renders, so the
	// full-tree spec walk never sits on the connect handshake (which fans out over every project).
	"project.hasSpecs": (params) => {
		const { projectId } = params as { projectId: string };
		const project = listProjects().find((p) => p.id === projectId);
		return { hasSpecs: project ? projectHasSpecs(project.path) : false };
	},
	"project.remove": (params) => {
		// Non-blocking archive of every workspace, then drop the project. Capture `repoPath` before
		// `closeProject` — background `reclaimWorktree` needs it once the project record is gone.
		const id = (params as { id: string }).id;
		const project = listProjects().find((p) => p.id === id);
		if (!project) return { ok: true } as const;
		const repoPath = project.path;
		const workspaces = listWorkspaceRecords(id);
		for (const ws of workspaces) {
			forgetWorkspace(ws.id);
			evictSpecIndex(ws.id);
			stopWatch(ws.id);
			closeWorkspaceTerminals(ws.id);
		}
		closeProject(id);
		// Fan project membership out after the record is gone (mirrors `workspace.removed` from
		// `forgetWorkspace`). Every client — including an optimistic initiator — drops the project row.
		publishProjectRemoved?.(id);
		for (const ws of workspaces) void archiveTeardown(ws, repoPath);
		return { ok: true } as const;
	},
	"workspace.create": (params) => {
		const p = params as { projectId: string; name?: string; baseRef?: string };
		return createWorkspace(p.projectId, p.name, p.baseRef);
	},
	"workspace.list": (params) => listWorkspaces((params as { projectId: string }).projectId),
	"workspace.remove": (params) => {
		const id = (params as { id: string }).id;
		// Non-blocking archive: drop the record now (gone from `workspace.list` immediately) + the fast
		// teardown, ack, then reclaim sessions/worktree in the background so the user never waits for the
		// slow git subprocess + session abort.
		const ws = forgetWorkspace(id);
		evictSpecIndex(id); // the archived worktree's spec parse cache must not outlive it
		stopWatch(id); // fast: stop the change notifier before the worktree dir is reclaimed
		closeWorkspaceTerminals(id); // fast: kill workspace-scoped PTYs before the dir is reclaimed
		if (ws) void archiveTeardown(ws);
		return { ok: true } as const;
	},
	"workspace.diffStats": (params) => workspaceDiffStats((params as { id: string }).id),
	"git.listBranches": (params) => listBranches((params as { projectId: string }).projectId),
	"git.prefetch": (params) => {
		const p = params as { projectId: string; ref: string };
		return prefetchBranch(p.projectId, p.ref);
	},
	"github.authStatus": () => githubAuthStatus(),
	"github.refresh": () => githubRefresh(),
	"dialog.selectDirectory": () => selectDirectory(),
	// Workspace reads double as the change-notifier trigger: a read means "a client is looking at this
	// worktree", so the host lazily starts its watcher (idempotent; unknown ids no-op, the read throws).
	"fs.readDir": (params) => {
		const p = params as { workspaceId: string; path: string };
		ensureWatch(p.workspaceId);
		return readDir(p.workspaceId, p.path);
	},
	"fs.readFile": (params) => {
		const p = params as { workspaceId: string; path: string };
		ensureWatch(p.workspaceId);
		return readFile(p.workspaceId, p.path);
	},
	"spec.graph": (params) => {
		const p = params as { workspaceId: string };
		ensureWatch(p.workspaceId);
		return specGraph(p.workspaceId);
	},
	"git.status": (params) => {
		const p = params as { workspaceId: string };
		ensureWatch(p.workspaceId);
		return gitStatus(p.workspaceId);
	},
	"git.diff": (params) => {
		const p = params as { workspaceId: string; path?: string };
		ensureWatch(p.workspaceId);
		return gitDiff(p.workspaceId, p.path);
	},
	"terminal.create": (params) => createTerminal((params as { workspaceId: string }).workspaceId),
	"terminal.write": (params) => {
		const p = params as { id: string; data: string };
		writeTerminal(p.id, p.data);
		return { ok: true } as const;
	},
	"terminal.resize": (params) => {
		const p = params as { id: string; cols: number; rows: number };
		resizeTerminal(p.id, p.cols, p.rows);
		return { ok: true } as const;
	},
	"terminal.close": (params) => {
		closeTerminal((params as { id: string }).id);
		return { ok: true } as const;
	},
	// session.* — the pi engine. A thrown/failed call returns a `{ ok:false, error }` WS response;
	// streaming faults arrive as `pi.event`s (the error/agent_end variants), not here.
	"session.create": async (params) => {
		const p = params as {
			workspaceId: string;
			model?: WireModel;
			thinkingLevel?: ThinkingLevel;
		};
		const ws = getWorkspace(p.workspaceId);
		return createSession({
			cwd: ws.worktreePath,
			workspaceId: p.workspaceId,
			...(p.model ? { model: p.model } : {}),
			...(p.thinkingLevel ? { thinkingLevel: p.thinkingLevel } : {}),
		});
	},
	// Sends are acked when ACCEPTED, not when the turn ends — see `ackSend` (a turn can outlive the
	// client's request timeout; an `ask_user_question` turn blocks until the user answers).
	"session.prompt": async (params) => {
		const p = params as { sessionId: string; text: string; images?: ImageContent[] };
		await ackSend(promptSession(p.sessionId, p.text, p.images));
		return { ok: true } as const;
	},
	"session.steer": async (params) => {
		const p = params as { sessionId: string; text: string; images?: ImageContent[] };
		await ackSend(steerSession(p.sessionId, p.text, p.images));
		return { ok: true } as const;
	},
	"session.followUp": async (params) => {
		const p = params as { sessionId: string; text: string; images?: ImageContent[] };
		await ackSend(followUpSession(p.sessionId, p.text, p.images));
		return { ok: true } as const;
	},
	"session.abort": async (params) => {
		await abortSession((params as { sessionId: string }).sessionId);
		return { ok: true } as const;
	},
	"session.dispose": (params) => {
		removeSession((params as { sessionId: string }).sessionId);
		return { ok: true } as const;
	},
	"session.setModel": async (params) => {
		const p = params as { sessionId: string; model: WireModel };
		await setSessionModel(p.sessionId, p.model);
		return { ok: true } as const;
	},
	"session.setThinkingLevel": (params) => {
		const p = params as { sessionId: string; level: ThinkingLevel };
		setSessionThinkingLevel(p.sessionId, p.level);
		return { ok: true } as const;
	},
	"session.compact": (params) => {
		const p = params as { sessionId: string; instructions?: string };
		compactSession(p.sessionId, p.instructions);
		return { ok: true } as const;
	},
	"session.getStats": (params) => getSessionStats((params as { sessionId: string }).sessionId),
	"session.getCommands": (params) =>
		getSessionCommands((params as { sessionId: string }).sessionId),
	"session.list": (params) => {
		const { workspaceId } = params as { workspaceId: string };
		return listSessions(workspaceId, getWorkspace(workspaceId).worktreePath);
	},
	"session.getMessages": (params) => {
		const p = params as { sessionId: string; workspaceId: string };
		return getSessionMessages(p.sessionId, p.workspaceId, getWorkspace(p.workspaceId).worktreePath);
	},
	"session.extUiReply": (params) => {
		resolveExtUi((params as { response: ExtUiResponse }).response);
		return { ok: true } as const;
	},
	"session.answerQuestion": (params) => {
		const p = params as { sessionId: string; toolCallId: string; result: AskUserQuestionResult };
		// Reply-style method: vet the target before holding anything (a disposed/unknown session must fail
		// the request, not silently park an answer), and reject shapes the tool envelope can't digest.
		if (!hasSession(p.sessionId)) throw new Error(`Unknown session: ${p.sessionId}`);
		if (!p.result || !Array.isArray(p.result.answers) || typeof p.result.cancelled !== "boolean")
			throw new Error("Malformed ask_user_question result");
		answerQuestion(p.sessionId, p.toolCallId, p.result);
		return { ok: true } as const;
	},
	"model.list": () => listAvailableModels(),
	"model.default": () => getDefaultModel(),
	"provider.status": () => getProviderStatus(),
	// In-app login. `loginStart` returns its handle at once (the flow runs detached — see `startLogin`);
	// frames stream on the `provider.login` channel, `loginReply` answers a live select/prompt frame.
	"provider.loginStart": (params) => startLogin((params as { providerId: string }).providerId),
	"provider.loginReply": (params) => {
		resolveLogin(params as LoginReply);
		return { ok: true } as const;
	},
	"provider.loginCancel": (params) => {
		cancelLogin((params as { loginId: string }).loginId);
		return { ok: true } as const;
	},
	"provider.setApiKey": (params) => {
		const p = params as { providerId: string; key: string };
		setProviderApiKey(p.providerId, p.key);
		return { ok: true } as const;
	},
	"provider.logout": (params) => {
		logoutProvider((params as { providerId: string }).providerId);
		return { ok: true } as const;
	},
	// JetBrains AI (jbcentral proxy): connect/disconnect write models.json + refresh the registry; login
	// launches `central login` (browser) on the host.
	"provider.jbcentralConnect": () => connectJbcentral(),
	"provider.jbcentralDisconnect": async () => {
		await disconnectJbcentral();
		return { ok: true } as const;
	},
	"provider.jbcentralLogin": () => jbcentralLogin(),
	// Merge + persist a partial into the server-synced app config (theme, …); the broadcast is fired by
	// `updateConfig`'s injected publisher (wired in `createServer`), so every client converges.
	"settings.update": (params) => updateConfig((params as { config: Partial<AppConfig> }).config),
};

/** Route a WS request to its handler. Throws on unknown method (→ a `{ ok:false }` WS response). */
export async function handleRequest(method: string, params: unknown): Promise<unknown> {
	const handler = handlers[method];
	if (!handler) throw new Error(`Unknown method: ${method}`);
	return handler(params);
}
