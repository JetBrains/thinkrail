import { selectDirectory } from "./dialog";
import { readDir, readFile } from "./files";
import { gitDiff, gitStatus } from "./git";
import { closeProject, listProjects, openProject } from "./projects";
import { closeTerminal, createTerminal, resizeTerminal, writeTerminal } from "./terminalManager";
import { createWorkspace, listWorkspaces, removeWorkspace, workspaceDiffStats } from "./workspaces";

type Handler = (params: unknown) => unknown | Promise<unknown>;

const handlers: Record<string, Handler> = {
	"project.open": (params) => openProject((params as { path: string }).path),
	"project.list": () => listProjects(),
	"project.close": (params) => {
		closeProject((params as { id: string }).id);
		return { ok: true } as const;
	},
	"workspace.create": (params) =>
		createWorkspace(
			(params as { projectId: string }).projectId,
			(params as { name?: string }).name,
		),
	"workspace.list": (params) => listWorkspaces((params as { projectId: string }).projectId),
	"workspace.remove": (params) => {
		removeWorkspace((params as { id: string }).id);
		return { ok: true } as const;
	},
	"workspace.diffStats": (params) => workspaceDiffStats((params as { id: string }).id),
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
	// session.* lands in M10.
};

/** Route a WS request to its handler. Throws on unknown method (→ a `{ ok:false }` WS response). */
export async function handleRequest(method: string, params: unknown): Promise<unknown> {
	const handler = handlers[method];
	if (!handler) throw new Error(`Unknown method: ${method}`);
	return handler(params);
}
