import type {
	AskUserQuestionResult,
	ExtUiResponse,
	ImageContent,
	Model,
	ThinkingLevel,
	Workspace,
} from "@thinkrail/contracts";
import {
	abortSession,
	answerQuestion,
	compactSession,
	createSession,
	followUpSession,
	getDefaultModel,
	getProviderStatus,
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
import { evictSpecIndex, projectHasSpecs, specGraph } from "../spec";
import {
	closeTerminal,
	closeWorkspaceTerminals,
	createTerminal,
	resizeTerminal,
	writeTerminal,
} from "../terminal";
import {
	createWorkspace,
	forgetWorkspace,
	getWorkspace,
	listWorkspaces,
	reclaimWorktree,
	workspaceDiffStats,
} from "../workspaces";
import { ackSend } from "./ackSend";

type Handler = (params: unknown) => unknown | Promise<unknown>;

/**
 * The slow half of archiving a workspace, run in the background after `workspace.remove` acks: tear down
 * the workspace's sessions (abort a streaming turn, dispose, purge on-disk transcripts) then reclaim the
 * worktree (`git worktree remove`). Sessions/terminals are down before the dir is deleted (terminals are
 * killed synchronously in the handler; sessions here, before the reclaim). Best-effort by contract — a
 * failure is logged, never thrown into the void (nothing awaits it).
 */
async function archiveTeardown(ws: Workspace): Promise<void> {
	try {
		await removeWorkspaceSessions(ws.id, ws.worktreePath);
		reclaimWorktree(ws);
	} catch (error) {
		console.warn(`workspace archive teardown failed for ${ws.id}: ${error}`);
	}
}

const handlers: Record<string, Handler> = {
	"project.open": (params) => openProject((params as { path: string }).path),
	"project.inspect": (params) => inspectProjectPath((params as { path: string }).path),
	"project.init": (params) => initProject((params as { path: string }).path),
	"project.list": () => listProjects(),
	// Lazy, per-project: the Welcome screen requests this only for the one project it renders, so the
	// full-tree spec walk never sits on the connect handshake (which fans out over every project).
	"project.hasSpecs": (params) => {
		const { projectId } = params as { projectId: string };
		const project = listProjects().find((p) => p.id === projectId);
		return { hasSpecs: project ? projectHasSpecs(project.path) : false };
	},
	"project.close": (params) => {
		closeProject((params as { id: string }).id);
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
	"fs.readDir": (params) =>
		readDir((params as { workspaceId: string }).workspaceId, (params as { path: string }).path),
	"fs.readFile": (params) =>
		readFile((params as { workspaceId: string }).workspaceId, (params as { path: string }).path),
	"spec.graph": (params) => specGraph((params as { workspaceId: string }).workspaceId),
	"git.status": (params) => gitStatus((params as { workspaceId: string }).workspaceId),
	"git.diff": (params) =>
		gitDiff((params as { workspaceId: string }).workspaceId, (params as { path?: string }).path),
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
			model?: Model<string>;
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
		const p = params as { sessionId: string; model: Model<string> };
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
};

/** Route a WS request to its handler. Throws on unknown method (→ a `{ ok:false }` WS response). */
export async function handleRequest(method: string, params: unknown): Promise<unknown> {
	const handler = handlers[method];
	if (!handler) throw new Error(`Unknown method: ${method}`);
	return handler(params);
}
