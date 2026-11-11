import type { Project, Workspace } from "@thinkrail/contracts";
import type { OpenChat } from "./WorkspaceScreen";

/** The bottom tab bar's roots, in its order. */
export const TABS = ["computers", "chats", "settings"] as const;
export type Tab = (typeof TABS)[number];

export interface InWorkspace {
	hostKey: string;
	project: Project;
	workspace: Workspace;
}

/**
 * A screen pushed over the tabs. `workspace` resolves which chat to land in (`sessionId` when one was picked,
 * else the workspace's main chat) and is replaced by that chat.
 */
export type Route =
	| { kind: "addComputer" }
	| { kind: "newWorktree"; hostKey: string; project: Project }
	| ({ kind: "workspace"; sessionId?: string } & InWorkspace)
	| ({ kind: "chat"; chat: OpenChat } & InWorkspace)
	| ({ kind: "history"; chat: OpenChat } & InWorkspace)
	| ({ kind: "subagent"; chat: OpenChat; childSessionId: string } & InWorkspace);

/** The screens over the active tab, bottom first; empty shows the tab itself. */
export type Stack = readonly Route[];

export const push = (stack: Stack, route: Route): Stack => [...stack, route];

export const pop = (stack: Stack): Stack => stack.slice(0, -1);

/**
 * Swaps `from` — and the `under` screens below it — for `to`, so back skips them: a resolved opener, a created
 * worktree's chat, a picked chat. Only while `from` is on top: a late answer after back, or under another
 * screen, changes nothing.
 */
export const replaceTop = (stack: Stack, from: Route, to: Route, under = 0): Stack =>
	stack.at(-1) === from ? [...stack.slice(0, -1 - under), to] : stack;

/** Leaves `from`, only while it is on top (a pairing that finished after back leaves nothing else). */
export const popIf = (stack: Stack, from: Route): Stack =>
	stack.at(-1) === from ? pop(stack) : stack;

/** Leaves every screen of a computer the phone lost, and whatever was pushed over them. */
export function leaveHost(stack: Stack, hostKey: string): Stack {
	const first = stack.findIndex((route) => "hostKey" in route && route.hostKey === hostKey);
	return first === -1 ? stack : stack.slice(0, first);
}
