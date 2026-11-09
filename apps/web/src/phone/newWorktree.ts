import type {
	BranchList,
	ThinkingLevel,
	WireModel,
	Workspace,
	WsResult,
} from "@thinkrail/contracts";

/** What the New worktree screen sends, as the IDE's New workspace dialog does. */
export interface NewWorktreeChoice {
	projectId: string;
	/** The branch to cut from; null keeps the project's default. */
	baseRef: string | null;
	/** Set only when the user picked a model, so an untouched choice follows the computer's default. */
	model: { model: WireModel; thinkingLevel: ThinkingLevel } | null;
	/** The first message; blank opens an empty chat. */
	prompt: string;
}

export interface StartedWorktree {
	workspace: Workspace;
	chat: { sessionId: string; model: WireModel | null; thinkingLevel: ThinkingLevel };
	/** The worktree and chat exist but the first message did not go: the chat opens with this to show. */
	promptError: string | null;
}

/** Which step failed, so the screen can say whether a worktree was left behind. */
export class WorktreeStartError extends Error {
	readonly step: "create" | "chat";
	readonly workspace: Workspace | null;
	constructor(step: "create" | "chat", message: string, workspace: Workspace | null) {
		super(message);
		this.step = step;
		this.workspace = workspace;
		this.name = "WorktreeStartError";
	}
}

type Request = <T>(method: string, params: unknown) => Promise<T>;

const messageOf = (error: unknown): string =>
	error instanceof Error ? error.message : String(error);

/** Create the worktree, start its chat with the chosen model, and send the task when there is one. */
export async function startWorktree(
	request: Request,
	choice: NewWorktreeChoice,
): Promise<StartedWorktree> {
	const workspace = await request<WsResult<"workspace.create">>("workspace.create", {
		projectId: choice.projectId,
		...(choice.baseRef ? { baseRef: choice.baseRef } : {}),
	}).catch((error: unknown) => {
		throw new WorktreeStartError("create", messageOf(error), null);
	});
	const chat = await request<WsResult<"session.create">>("session.create", {
		workspaceId: workspace.id,
		...(choice.model ? choice.model : {}),
	}).catch((error: unknown) => {
		throw new WorktreeStartError("chat", messageOf(error), workspace);
	});
	const text = choice.prompt.trim();
	const promptError = text
		? await request("session.prompt", { sessionId: chat.sessionId, text }).then(
				() => null,
				messageOf,
			)
		: null;
	return { workspace, chat, promptError };
}

/** The branches to offer as a base: the default first, then the other local ones, then remote-only ones. */
export function baseBranches(list: BranchList): string[] {
	const local = list.local.filter((branch) => branch !== list.defaultBranch);
	const known = new Set([list.defaultBranch, ...local]);
	const remote = list.remote.filter((branch) => !known.has(branch));
	return [list.defaultBranch, ...local, ...remote];
}
