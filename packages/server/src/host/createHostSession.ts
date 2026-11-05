import type { WsParams, WsResult } from "@thinkrail/contracts";
import { createSession, renameSession } from "../agent";
import { noteRecentModel } from "../settings";
import { ensureWorkspaceScratchDir, getWorkspace } from "../workspaces";
import { trackChatStarted } from "./authAnalytics";
import { resolveNewChatModel } from "./newChatModel";

type Dependencies = {
	getWorkspace: typeof getWorkspace;
	ensureWorkspaceScratchDir: typeof ensureWorkspaceScratchDir;
	resolveNewChatModel: typeof resolveNewChatModel;
	createSession: typeof createSession;
	noteRecentModel: (model: Parameters<typeof noteRecentModel>[0]) => void;
	trackChatStarted: typeof trackChatStarted;
	renameSession: typeof renameSession;
};

/** Internal test seam; production uses the existing host composition dependencies below. */
export function createHostSessionFactory(dependencies: Dependencies) {
	return async (
		input: WsParams<"session.create">,
		guard?: () => void,
		options: { title?: string | undefined } = {},
	): Promise<WsResult<"session.create">> => {
		guard?.();
		const workspace = dependencies.getWorkspace(input.workspaceId);
		const { id, projectId, worktreePath } = workspace;
		dependencies.ensureWorkspaceScratchDir(workspace);
		const defaults = await dependencies.resolveNewChatModel(input);
		guard?.();
		// Workspace reads return fresh records: compare persistent identity, not object references.
		const current = dependencies.getWorkspace(input.workspaceId);
		if (
			current.id !== id ||
			current.projectId !== projectId ||
			current.worktreePath !== worktreePath
		) {
			throw new Error(
				"The workspace changed while resolving the chat model — retry with its current settings.",
			);
		}
		guard?.();
		const created = await dependencies.createSession({
			cwd: current.worktreePath,
			workspaceId: input.workspaceId,
			...(defaults.model ? { model: defaults.model } : {}),
			thinkingLevel: defaults.thinkingLevel,
		});
		// A guard failure here leaves creation uncertain; only the caller owns its pending marker.
		guard?.();
		if (options.title) {
			// A title is cosmetic: a failed rename keeps the created chat instead of stranding it.
			await dependencies
				.renameSession(created.sessionId, input.workspaceId, current.worktreePath, options.title)
				.catch(() => false);
			guard?.();
		}
		if (input.model && created.model) dependencies.noteRecentModel(created.model);
		dependencies.trackChatStarted({
			sessionId: created.sessionId,
			model: defaults.model ? created.model : null,
		});
		return created;
	};
}

export const createHostSession = createHostSessionFactory({
	getWorkspace,
	ensureWorkspaceScratchDir,
	resolveNewChatModel,
	createSession,
	noteRecentModel,
	trackChatStarted,
	renameSession,
});
