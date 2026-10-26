import type { ThinkingLevel, WireModel, Workspace } from "@thinkrail/contracts";
import { type CreateSessionResult, createSession } from "../agent";
import { ensureWorkspaceScratchDir } from "../workspaces";
import { trackChatStarted } from "./authAnalytics";
import { resolveNewChatModel } from "./newChatModel";

export async function startChatSession(
	workspace: Workspace,
	requested: { model?: WireModel; thinkingLevel?: ThinkingLevel },
): Promise<CreateSessionResult> {
	ensureWorkspaceScratchDir(workspace);
	const defaults = await resolveNewChatModel(requested);
	const created = await createSession({
		cwd: workspace.worktreePath,
		workspaceId: workspace.id,
		...(defaults.model ? { model: defaults.model } : {}),
		thinkingLevel: defaults.thinkingLevel,
	});
	trackChatStarted({
		sessionId: created.sessionId,
		model: defaults.model ? created.model : null,
	});
	return created;
}
