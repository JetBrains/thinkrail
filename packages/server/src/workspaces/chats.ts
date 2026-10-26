import { randomUUID } from "node:crypto";
import { mkdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { ChatContinuationLink, Project, Workspace } from "@thinkrail/contracts";
import { CodedError } from "@thinkrail/shared/codedError";
import {
	type ChatsStoreProblem,
	chatsRoot,
	chatsStoreProblem,
	isChatsContainer,
	isChatWorkspace,
	isUnderChatsRoot,
	loadProjects,
	loadWorkspaces,
	saveProjects,
	saveWorkspaces,
} from "../persistence";

export { chatsRoot, isChatsContainer, isChatWorkspace, isUnderChatsRoot };

export const CHATS_CONTAINER_NAME = "Chats";
export const CHAT_WORKSPACE_NAME = "Chat";
const CHAT_ID_LENGTH = 6;

type ChatPublishers = {
	project: (project: Project) => void;
	workspace: (event: { kind: "created" | "updated"; workspace: Workspace }) => void;
	removed: (projectId: string, id: string) => void;
};

let publishers: ChatPublishers | null = null;

export function setChatPublishers(next: ChatPublishers | null): void {
	publishers = next;
}

const CHATS_STORE_PROBLEMS: Record<ChatsStoreProblem, string> = {
	"set-aside":
		"The chats store was unreadable and was set aside; restart ThinkRail to write chats again.",
	newer: "The chats store was written by a newer ThinkRail; update ThinkRail to write chats.",
	unreadable: "The chats store could not be read; try again.",
};

function assertChatsWritable(): void {
	const problem = chatsStoreProblem();
	if (problem) throw new CodedError("CHATS_STORE_UNAVAILABLE", CHATS_STORE_PROBLEMS[problem]);
}

/** The one Chats container, found by kind or created with an opaque id; its root exists afterwards. */
export function ensureChatsContainer(): Project {
	assertChatsWritable();
	mkdirSync(chatsRoot(), { recursive: true });
	const projects = loadProjects();
	const existing = projects.find(isChatsContainer);
	if (existing) {
		if (existing.path === chatsRoot() && existing.closed === undefined) return existing;
		existing.path = chatsRoot();
		delete existing.closed;
		saveProjects(projects);
		publishers?.project(existing);
		return existing;
	}
	const container: Project = {
		id: randomUUID(),
		name: CHATS_CONTAINER_NAME,
		path: chatsRoot(),
		slug: "chats",
		lastOpened: Date.now(),
		kind: "chats",
		trusted: false,
		piResourceTrust: "untrusted",
	};
	projects.push(container);
	saveProjects(projects);
	containerId = container.id;
	publishers?.project(container);
	return container;
}

export function findChatsContainer(): Project | null {
	return loadProjects().find(isChatsContainer) ?? null;
}

function localDate(now: Date): string {
	const pad = (value: number) => String(value).padStart(2, "0");
	return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function freshFolder(root: string, now: Date): string {
	const date = localDate(now);
	let id = randomUUID().replace(/-/g, "").slice(0, CHAT_ID_LENGTH);
	for (;;) {
		const folder = join(root, `${date}-${id}`);
		if (!statSync(folder, { throwIfNoEntry: false })) return folder;
		id += randomUUID().replace(/-/g, "").slice(0, 2);
	}
}

/** Creates the chat's folder and record; the session that owns the folder is the host's to start. */
export function createChatRecord(now = new Date()): Workspace {
	const container = ensureChatsContainer();
	const folder = freshFolder(container.path, now);
	mkdirSync(folder);
	const workspace: Workspace = {
		id: randomUUID(),
		projectId: container.id,
		kind: "chat",
		name: CHAT_WORKSPACE_NAME,
		branch: "",
		worktreePath: folder,
		baseBranch: "",
		renamed: true,
		initialTerminalPending: true,
		lastActiveAt: now.getTime(),
	};
	const all = loadWorkspaces();
	all.push(workspace);
	saveWorkspaces(all);
	knownChatIds().add(workspace.id);
	publishers?.workspace({ kind: "created", workspace });
	return workspace;
}

export function chatWorkspaces(): Workspace[] {
	return loadWorkspaces()
		.filter(isChatWorkspace)
		.sort((a, b) => (b.lastActiveAt ?? 0) - (a.lastActiveAt ?? 0));
}

export function getChatWorkspace(id: string): Workspace {
	const workspace = loadWorkspaces().find((candidate) => candidate.id === id);
	if (!workspace || !isChatWorkspace(workspace)) {
		throw new CodedError("NOT_A_CHAT", `Not a chat without a project: ${id}`);
	}
	return workspace;
}

let chatIds: Set<string> | null = null;
let containerId: string | null | undefined;

function knownChatIds(): Set<string> {
	if (!chatIds) chatIds = new Set(chatWorkspaces().map((workspace) => workspace.id));
	return chatIds;
}

/** Answered from memory: pushes ask this per event, and only this process writes the chats store. */
export function isChatWorkspaceId(id: string): boolean {
	return knownChatIds().has(id);
}

export function isChatsContainerId(id: string): boolean {
	if (containerId === undefined) containerId = findChatsContainer()?.id ?? null;
	return containerId === id;
}

/** Tests swap the data dir under a running module; the next ask re-reads the store. */
export function resetChatIdCache(): void {
	chatIds = null;
	containerId = undefined;
}

/** Persisted before any destructive step, so a crash leaves a visible "deletion incomplete" chat, never a half-gone one. */
export function markChatDeletionPending(id: string): Workspace {
	assertChatsWritable();
	const all = loadWorkspaces();
	const workspace = all.find((candidate) => candidate.id === id);
	if (!workspace || !isChatWorkspace(workspace)) {
		throw new CodedError("NOT_A_CHAT", `Not a chat without a project: ${id}`);
	}
	if (workspace.deletionPending) return workspace;
	workspace.deletionPending = true;
	saveWorkspaces(all);
	publishers?.workspace({ kind: "updated", workspace });
	return workspace;
}

/** The durable link from a chat to the workspace its summary went to — survives compaction of the transcript card. */
export function recordChatContinuation(id: string, link: ChatContinuationLink): Workspace {
	assertChatsWritable();
	const all = loadWorkspaces();
	const workspace = all.find((candidate) => candidate.id === id);
	if (!workspace || !isChatWorkspace(workspace)) {
		throw new CodedError("NOT_A_CHAT", `Not a chat without a project: ${id}`);
	}
	const links = workspace.continuedTo ?? [];
	if (links.some((candidate) => candidate.workspaceId === link.workspaceId)) return workspace;
	workspace.continuedTo = [...links, link];
	saveWorkspaces(all);
	publishers?.workspace({ kind: "updated", workspace });
	return workspace;
}

export function dropChatRecord(id: string): void {
	const all = loadWorkspaces();
	const workspace = all.find((candidate) => candidate.id === id);
	if (!workspace) return;
	saveWorkspaces(all.filter((candidate) => candidate.id !== id));
	knownChatIds().delete(id);
	publishers?.removed(workspace.projectId, id);
}

/** The container is never a repository: nothing may give it a Default workspace or a worktree. */
export function assertNotChatsContainer(project: Pick<Project, "id" | "kind">): void {
	if (isChatsContainer(project)) {
		throw new CodedError(
			"CHATS_CONTAINER",
			`${CHATS_CONTAINER_NAME} holds chats without a project; it is not a repository.`,
		);
	}
}

export function assertNotChatWorkspace(workspace: Pick<Workspace, "kind">, action: string): void {
	if (isChatWorkspace(workspace)) {
		throw new CodedError("CHAT_WORKSPACE", `A chat without a project cannot be ${action}.`);
	}
}
