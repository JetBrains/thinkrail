import type { Workspace } from "@thinkrail/contracts";
import { SESSION_TITLE_MAX_LENGTH } from "@thinkrail/contracts";
import {
	getSessionWorkspaceId,
	renameSession,
	type SetTitleParams,
	type TitleToolHost,
} from "../agent";
import { logger } from "../log";
import { getWorkspace, renameWorkspace } from "../workspaces";

const log = logger("host");

const MAX_WORKSPACE_NAME = 60;

export interface AgentTitleDeps {
	workspaceOf: (sessionId: string) => string | undefined;
	writeChatTitle: typeof renameSession;
}

const liveDeps: AgentTitleDeps = {
	workspaceOf: getSessionWorkspaceId,
	writeChatTitle: renameSession,
};

export const titleToolHost: TitleToolHost = {
	apply: (sessionId, params) => applyAgentTitle(sessionId, params),
	workspaceNeedsName,
};

export function workspaceNeedsName(sessionId: string): boolean {
	const workspaceId = getSessionWorkspaceId(sessionId);
	return workspaceId !== undefined && workspaceStillNameable(workspaceId);
}

function isNameable(workspace: Workspace): boolean {
	return !workspace.kind && !workspace.renamed;
}

export async function applyAgentTitle(
	sessionId: string,
	params: SetTitleParams,
	deps: AgentTitleDeps = liveDeps,
): Promise<string> {
	const workspaceId = deps.workspaceOf(sessionId);
	if (!workspaceId) throw new Error("set_title is only available in a top-level chat.");
	const chatTitle = clampWords(params.chat_title, SESSION_TITLE_MAX_LENGTH);
	const workspaceName = clampWords(params.workspace_name, MAX_WORKSPACE_NAME);
	if (!chatTitle && !workspaceName) throw new Error("Pass chat_title and/or workspace_name.");
	if (params.branch?.trim() && !workspaceName) {
		throw new Error("branch names the workspace branch: pass it together with workspace_name.");
	}

	const lines: string[] = [];
	if (chatTitle) lines.push(await applyChatTitle(deps, sessionId, workspaceId, chatTitle));
	if (workspaceName) lines.push(applyWorkspaceName(workspaceId, workspaceName, params.branch));
	else if (workspaceStillNameable(workspaceId)) {
		lines.push("Workspace is still unnamed: call set_title again with workspace_name and branch.");
	}
	return lines.join("\n");
}

function workspaceStillNameable(workspaceId: string): boolean {
	try {
		return isNameable(getWorkspace(workspaceId));
	} catch {
		return false;
	}
}

async function applyChatTitle(
	deps: AgentTitleDeps,
	sessionId: string,
	workspaceId: string,
	title: string,
) {
	try {
		const cwd = getWorkspace(workspaceId).worktreePath;
		const applied = await deps.writeChatTitle(sessionId, workspaceId, cwd, title, {
			onlyIfUnnamed: true,
		});
		return applied
			? `Chat title set to "${title}".`
			: "Chat title kept: this chat is already named.";
	} catch (error) {
		log.warn(`set_title chat write failed (${sessionId})`);
		return `Chat title not set: ${errorText(error)}`;
	}
}

function applyWorkspaceName(workspaceId: string, name: string, branch: string | undefined) {
	try {
		const workspace = getWorkspace(workspaceId);
		if (workspace.kind) return "Workspace name kept: this workspace is not renamable.";
		if (!isNameable(workspace)) return "Workspace name kept: this workspace is already named.";
		const renamed = renameWorkspace(workspaceId, name, branch ? { branch } : {});
		return `Workspace renamed to "${renamed.name}" (branch ${renamed.branch}).`;
	} catch (error) {
		log.warn(`set_title workspace write failed (${workspaceId})`);
		return `Workspace name not set: ${errorText(error)}`;
	}
}

function clampWords(raw: string | undefined, max: number): string | null {
	const text = raw?.replace(/\s+/g, " ").trim();
	if (!text || !/[\p{L}\p{N}]/u.test(text)) return null;
	if (text.length <= max) return text;
	const cut = text.slice(0, max + 1);
	const boundary = cut.lastIndexOf(" ");
	return (boundary > 0 ? cut.slice(0, boundary) : text.slice(0, max)).trimEnd();
}

function errorText(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
