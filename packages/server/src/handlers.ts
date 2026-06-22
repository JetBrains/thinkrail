import { closeProject, listProjects, openProject } from "./projects";
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
	// fs.* / git.* / terminal.* / session.* land in M6–M10.
};

/** Route a WS request to its handler. Throws on unknown method (→ a `{ ok:false }` WS response). */
export async function handleRequest(method: string, params: unknown): Promise<unknown> {
	const handler = handlers[method];
	if (!handler) throw new Error(`Unknown method: ${method}`);
	return handler(params);
}
