import { homedir } from "node:os";
import { isAbsolute, relative, resolve, sep } from "node:path";
import type { PiEvent } from "@thinkrail/contracts";
import { hasSession } from "../agent";
import type { ExtensionChatFacts } from "../extensions";
import { listAllWorkspaceRecords } from "../workspaces";

type LastAction = NonNullable<ExtensionChatFacts["lastAction"]>;

const FILE_TOOLS: ReadonlySet<string> = new Set(["read", "edit", "write"]);
export const COMMAND_TARGET_MAX = 60;
export const PATH_TARGET_MAX = 120;
const TOOL_NAME_MAX = 100;

function clipEnd(text: string, max: number): string {
	return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function clipStart(text: string, max: number): string {
	return text.length <= max ? text : `…${text.slice(text.length - max + 1)}`;
}

/** `path` as pi resolves it against the worktree, `/`-separated; `undefined` when it leaves the worktree. */
function workspacePath(path: string, root: string): string | undefined {
	const raw = path.trim().replace(/^@/, "");
	if (!raw || raw.startsWith("~")) return undefined;
	const rel = relative(root, resolve(root, raw));
	if (!rel || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return undefined;
	return rel.split(sep).join("/");
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Replaces the folder `dir` where it is a whole path (alone or followed by `/`), never a sibling's prefix. */
function shorten(command: string, dir: string, inside: string, alone: string): string {
	if (dir.length < 2) return command;
	const at = escapeRegExp(dir.replace(/\/+$/, ""));
	return command
		.replace(new RegExp(`${at}/`, "g"), inside)
		.replace(new RegExp(`${at}(?=$|[\\s'"\`;&|)<>])`, "g"), alone);
}

/**
 * A short, safe target for a tool call: a workspace-relative path for read / edit / write (omitted when
 * it leaves the worktree), the start of a bash command with the worktree and home folders shortened, else
 * nothing.
 */
export function lastActionTarget(
	tool: string,
	args: unknown,
	root: string | null,
	home: string = homedir(),
): string | undefined {
	if (typeof args !== "object" || args === null) return undefined;
	const fields = args as Record<string, unknown>;
	if (FILE_TOOLS.has(tool)) {
		if (typeof fields.path !== "string" || root === null) return undefined;
		const path = workspacePath(fields.path, root);
		return path ? clipStart(path, PATH_TARGET_MAX) : undefined;
	}
	if (tool === "bash") {
		if (typeof fields.command !== "string") return undefined;
		let command = fields.command.replace(/\s+/g, " ").trim();
		if (root) command = shorten(command, root, "", ".");
		command = shorten(command, home, "~/", "~");
		return command ? clipEnd(command, COMMAND_TARGET_MAX) : undefined;
	}
	return undefined;
}

export interface LastActions {
	/** Records a session's tool execution start; other events are ignored. */
	note(workspaceId: string, sessionId: string, event: PiEvent): void;
	/** A live session's most recent tool start; a disposed session's entry is dropped instead. */
	get(sessionId: string): LastAction | undefined;
	forget(sessionId: string): void;
}

/** Each session's most recent tool start, in memory only, for the `workspaceFacts` host fact. */
export function createLastActions(options: {
	isLive: (sessionId: string) => boolean;
	rootOf: (workspaceId: string) => string | null;
	now?: () => number;
	home?: string;
}): LastActions {
	const actions = new Map<string, LastAction>();
	const now = options.now ?? Date.now;
	return {
		note(workspaceId, sessionId, event) {
			if (event.type !== "tool_execution_start") return;
			for (const id of actions.keys())
				if (id !== sessionId && !options.isLive(id)) actions.delete(id);
			const tool = event.toolName.slice(0, TOOL_NAME_MAX);
			const target = lastActionTarget(tool, event.args, options.rootOf(workspaceId), options.home);
			actions.set(sessionId, { tool, ...(target ? { target } : {}), at: now() });
		},
		get(sessionId) {
			if (options.isLive(sessionId)) return actions.get(sessionId);
			actions.delete(sessionId);
			return undefined;
		},
		forget(sessionId) {
			actions.delete(sessionId);
		},
	};
}

export const lastActions = createLastActions({
	isLive: hasSession,
	rootOf: (workspaceId) =>
		listAllWorkspaceRecords().find((workspace) => workspace.id === workspaceId)?.worktreePath ??
		null,
});
