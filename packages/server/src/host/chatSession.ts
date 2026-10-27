import type { Workspace } from "@thinkrail/contracts";
import { type CreateSessionResult, createSession } from "../agent";
import { ensureWorkspaceScratchDir } from "../workspaces";
import { type NewChatModelRequest, noteNewChat, resolveNewChatModel } from "./newChatModel";

export interface ChatStartOptions {
	readonly pick?: boolean;
	readonly assertClaimed?: () => void;
}

export async function startChatSession(
	workspace: Workspace,
	requested: NewChatModelRequest,
	{ pick = false, assertClaimed = () => {} }: ChatStartOptions = {},
): Promise<CreateSessionResult> {
	const defaults = await resolveNewChatModel(requested);
	assertClaimed();
	ensureWorkspaceScratchDir(workspace);
	let created: CreateSessionResult;
	try {
		created = await createSession({
			cwd: workspace.worktreePath,
			workspaceId: workspace.id,
			...(defaults.model ? { model: defaults.model } : {}),
			thinkingLevel: defaults.thinkingLevel,
		});
	} catch (error) {
		assertClaimed();
		throw error;
	}
	assertClaimed();
	noteNewChat(pick ? requested : {}, defaults, created);
	return created;
}
