import type { ExtUiResponse, ImageContent, Model, ThinkingLevel } from "@thinkrail-pi/contracts";
import {
	abortSession,
	compactSession,
	createSession,
	followUpSession,
	getDefaultModel,
	getSessionCommands,
	getSessionMessages,
	getSessionStats,
	listAvailableModels,
	listSessions,
	promptSession,
	removeSession,
	resolveExtUi,
	setSessionModel,
	setSessionThinkingLevel,
	steerSession,
} from "../agent";
import { selectDirectory } from "../dialog";
import { readDir, readFile } from "../fs";
import { gitDiff, gitStatus, listBranches } from "../git";
import { githubAuthStatus, githubRefresh } from "../github";
import { closeProject, listProjects, openProject } from "../projects";
import { closeTerminal, createTerminal, resizeTerminal, writeTerminal } from "../terminal";
import {
	createWorkspace,
	getWorkspace,
	listWorkspaces,
	removeWorkspace,
	workspaceDiffStats,
} from "../workspaces";

type Handler = (params: unknown) => unknown | Promise<unknown>;

const handlers: Record<string, Handler> = {
	"project.open": (params) => openProject((params as { path: string }).path),
	"project.list": () => listProjects(),
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
		removeWorkspace((params as { id: string }).id);
		return { ok: true } as const;
	},
	"workspace.diffStats": (params) => workspaceDiffStats((params as { id: string }).id),
	"git.listBranches": (params) => listBranches((params as { projectId: string }).projectId),
	"github.authStatus": () => githubAuthStatus(),
	"github.refresh": () => githubRefresh(),
	"dialog.selectDirectory": () => selectDirectory(),
	"fs.readDir": (params) =>
		readDir((params as { workspaceId: string }).workspaceId, (params as { path: string }).path),
	"fs.readFile": (params) =>
		readFile((params as { workspaceId: string }).workspaceId, (params as { path: string }).path),
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
	"session.prompt": async (params) => {
		const p = params as { sessionId: string; text: string; images?: ImageContent[] };
		await promptSession(p.sessionId, p.text, p.images);
		return { ok: true } as const;
	},
	"session.steer": async (params) => {
		const p = params as { sessionId: string; text: string; images?: ImageContent[] };
		await steerSession(p.sessionId, p.text, p.images);
		return { ok: true } as const;
	},
	"session.followUp": async (params) => {
		const p = params as { sessionId: string; text: string; images?: ImageContent[] };
		await followUpSession(p.sessionId, p.text, p.images);
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
	"model.list": () => listAvailableModels(),
	"model.default": () => getDefaultModel(),
};

/** Route a WS request to its handler. Throws on unknown method (→ a `{ ok:false }` WS response). */
export async function handleRequest(method: string, params: unknown): Promise<unknown> {
	const handler = handlers[method];
	if (!handler) throw new Error(`Unknown method: ${method}`);
	return handler(params);
}
