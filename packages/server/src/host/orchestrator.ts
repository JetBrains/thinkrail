import type {
	ChatCreateResult,
	Container,
	ContainerBriefDetails,
	ContainerOrchestrator,
	SessionSummary,
	Workspace,
} from "@thinkrail/contracts";
import {
	CONTAINER_BRIEF_CUSTOM_TYPE,
	chatState,
	SESSION_TITLE_MAX_LENGTH,
} from "@thinkrail/contracts";
import { CodedError } from "@thinkrail/shared/codedError";
import { appendHostMessageToSession, listSessions, renameSession } from "../agent";
import {
	addContainerWorkspace,
	createContainer,
	listContainers,
	prepareContainerHome,
	setContainerOrchestrator,
} from "../containers";
import { logger } from "../log";
import { getProjects } from "../projects";
import {
	getChatWorkspace,
	isChatWorkspaceId,
	listAllWorkspaceRecords,
	orchestratorChat,
} from "../workspaces";
import { assertChatOpen, createOrchestratorChat, deleteChat, recoverChatSession } from "./chats";
import type { NewChatModelRequest } from "./newChatModel";
import { chatName, prLine } from "./workspaceTools";

const log = logger("host");

function orchestratorName(containerName: string): string {
	return `Orchestrator · ${containerName}`.slice(0, SESSION_TITLE_MAX_LENGTH).trimEnd();
}

interface MemberReport {
	workspace: Workspace;
	projectName: string;
	chats: SessionSummary[] | Error;
}

function containerBrief(container: Container, members: readonly MemberReport[]): string {
	const lines = [
		`This chat orchestrates the container "${container.name}" (id ${container.id}). Your working folder is its home: each member's code is linked under workspaces/, and shared artifacts go in .thinkrail/context/.`,
		"",
		`Members (${members.length}):`,
	];
	for (const { workspace, projectName, chats } of members) {
		lines.push(
			`- ${projectName} · ${workspace.name} — branch ${workspace.branch} · ${prLine(workspace)} (workspace id ${workspace.id})`,
		);
		if (chats instanceof Error) {
			lines.push(`  chats unreadable: ${chats.message}`);
			continue;
		}
		if (chats.length === 0) lines.push("  no chats");
		for (const chat of chats)
			lines.push(`  - chat ${chatName(chat)} (${chat.sessionId}): ${chatState(chat.state)}`);
	}
	lines.push("", "This summary is context, not a task: wait for the human's request.");
	return lines.join("\n");
}

async function memberReports(container: Container): Promise<MemberReport[]> {
	const workspaces = new Map(
		listAllWorkspaceRecords().map((workspace) => [workspace.id, workspace]),
	);
	const projects = new Map(getProjects().map((project) => [project.id, project.name]));
	const members = container.workspaceIds.flatMap((id) => workspaces.get(id) ?? []);
	return Promise.all(
		members.map(async (workspace) => ({
			workspace,
			projectName: projects.get(workspace.projectId) ?? workspace.projectId,
			chats: await listSessions(workspace.id, workspace.worktreePath).catch((error: unknown) =>
				error instanceof Error ? error : new Error(String(error)),
			),
		})),
	);
}

function requireContainer(containerId: string): Container {
	const container = listContainers().find((candidate) => candidate.id === containerId);
	if (!container) throw new CodedError("CONTAINER_UNKNOWN", `Unknown container: ${containerId}`);
	return container;
}

/** Names the session, appends the brief (no turn), then links it: a container that is gone throws. */
async function seedOrchestrator(chat: Workspace, sessionId: string): Promise<Container> {
	const container = requireContainer(chat.orchestratorOf ?? "");
	try {
		await renameSession(sessionId, chat.id, chat.worktreePath, orchestratorName(container.name));
	} catch (error) {
		log.warn(`orchestrator session ${sessionId} kept its title`, error);
	}
	try {
		const details: ContainerBriefDetails = { containerId: container.id };
		const brief = containerBrief(container, await memberReports(container));
		await appendHostMessageToSession(sessionId, CONTAINER_BRIEF_CUSTOM_TYPE, brief, details);
	} catch (error) {
		log.warn(`orchestrator session ${sessionId} got no brief`, error);
	}
	return setContainerOrchestrator(container.id, sessionId);
}

/** `session.create` for an orchestrator chat whose session never came up: the new session is seeded and linked too. */
export async function recoverOrchestratorSession(
	chat: Workspace,
	requested: NewChatModelRequest,
): Promise<ChatCreateResult> {
	const created = await recoverChatSession(chat.id, requested);
	try {
		await seedOrchestrator(chat, created.sessionId);
	} catch (error) {
		log.warn(`orchestrator session ${created.sessionId} is not linked to its container`, error);
	}
	return created;
}

async function ensureOrchestrator(
	containerId: string,
	requested: NewChatModelRequest,
): Promise<ContainerOrchestrator> {
	const container = requireContainer(containerId);
	const existing = orchestratorChat(containerId);
	if (existing) {
		assertChatOpen(existing.id);
		const sessions = await listSessions(existing.id, existing.worktreePath);
		const kept =
			sessions.find((session) => session.sessionId === container.orchestratorSessionId) ??
			sessions[0];
		if (kept) {
			const linked = setContainerOrchestrator(containerId, kept.sessionId);
			return { container: linked, workspace: existing, sessionId: kept.sessionId };
		}
		const { sessionId } = await recoverOrchestratorSession(existing, requested);
		return { container: requireContainer(containerId), workspace: existing, sessionId };
	}
	const home = prepareContainerHome(containerId);
	const name = orchestratorName(container.name);
	const created = await createOrchestratorChat(containerId, home, name, requested);
	try {
		const linked = await seedOrchestrator(created.workspace, created.sessionId);
		return { container: linked, workspace: created.workspace, sessionId: created.sessionId };
	} catch (error) {
		await deleteChat(created.workspace.id).catch((cleanup: unknown) =>
			log.warn(`the orphaned orchestrator chat ${created.workspace.id} was not deleted`, cleanup),
		);
		throw error;
	}
}

const starting = new Map<string, Promise<ContainerOrchestrator>>();

/** `container.startOrchestrator`: the container's one orchestrator, created (seeded, no turn) or answered as it is. */
export function startContainerOrchestrator(
	containerId: string,
	requested: NewChatModelRequest = {},
): Promise<ContainerOrchestrator> {
	const inFlight = starting.get(containerId);
	if (inFlight) return inFlight;
	const done: Promise<ContainerOrchestrator> = ensureOrchestrator(containerId, requested).finally(
		() => {
			if (starting.get(containerId) === done) starting.delete(containerId);
		},
	);
	starting.set(containerId, done);
	return done;
}

/** Resolves once every orchestrator start in flight has ended, however it ended. */
export async function settleOrchestratorStartsForTests(): Promise<void> {
	await Promise.allSettled([...starting.values()]);
}

function orchestrate(container: Container): void {
	if (container.orchestratorSessionId) return;
	startContainerOrchestrator(container.id).catch((error: unknown) =>
		log.warn(`container ${container.id} got no orchestrator`, error),
	);
}

/** `container.create`: a container made with two or more members gets its orchestrator. */
export function createContainerOrchestrated(params: {
	name?: string;
	workspaceIds: string[];
}): Container {
	const container = createContainer(params);
	if (container.workspaceIds.length >= 2) orchestrate(container);
	return container;
}

/** `container.addWorkspace`: the add that brings a container to two members gives it its orchestrator. */
export function addContainerWorkspaceOrchestrated(
	containerId: string,
	workspaceId: string,
): Container {
	const before = listContainers().find((candidate) => candidate.id === containerId);
	const container = addContainerWorkspace(containerId, workspaceId);
	if ((before?.workspaceIds.length ?? 0) < 2 && container.workspaceIds.length >= 2)
		orchestrate(container);
	return container;
}

/** The containers dissolve hook: an orchestrator still starting finishes first, then its chat is deleted like any chat. */
export async function disposeContainerOrchestrator(container: Container): Promise<void> {
	await starting.get(container.id)?.catch(() => {});
	const chat = orchestratorChat(container.id);
	if (chat) await deleteChat(chat.id);
}

/** The agent's resolver: an orchestrator chat's home, `null` for every other workspace. */
export function orchestratorHomeOf(workspaceId: string): string | null {
	if (!isChatWorkspaceId(workspaceId)) return null;
	const chat = getChatWorkspace(workspaceId);
	return chat.orchestratorOf ? chat.worktreePath : null;
}
