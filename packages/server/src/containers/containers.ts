import { randomUUID } from "node:crypto";
import type { Container, Workspace } from "@thinkrail/contracts";
import { CodedError } from "@thinkrail/shared/codedError";
import { logger } from "../log";
import { loadContainers, loadProjects, loadWorkspaces, saveContainers } from "../persistence";
import { containerHome, retireContainerHome, syncContainerHome } from "./home";

const log = logger("containers");

export type ContainerEvent =
	| { kind: "updated"; container: Container }
	| { kind: "removed"; id: string };

type ContainerPublisher = (event: ContainerEvent) => void;

let publish: ContainerPublisher | null = null;

export function setContainerPublisher(fn: ContainerPublisher | null): void {
	publish = fn;
}

type DissolveHook = (container: Container) => Promise<void>;

let beforeRetire: DissolveHook | null = null;

/** Awaited on every dissolve after the record is gone and before its home is retired. */
export function setContainerDissolveHook(fn: DissolveHook | null): void {
	beforeRetire = fn;
}

const MAX_NAME = 80;

function displayName(raw: unknown): string | null {
	if (typeof raw !== "string") return null;
	const name = raw.trim().replace(/\s+/g, " ").slice(0, MAX_NAME).trimEnd();
	return name === "" ? null : name;
}

function writableContainers(): Container[] {
	const loaded = loadContainers();
	if (!loaded.writable)
		throw new CodedError(
			"CONTAINERS_STORE_UNAVAILABLE",
			"Containers were saved by a newer ThinkRail; update this host to change them",
		);
	return loaded.containers;
}

function requireContainer(all: readonly Container[], id: string): Container {
	const container = all.find((candidate) => candidate.id === id);
	if (!container) throw new CodedError("CONTAINER_UNKNOWN", `Unknown container: ${id}`);
	return container;
}

function admitMember(
	all: readonly Container[],
	workspaces: readonly Workspace[],
	workspaceId: unknown,
): Workspace {
	const workspace = workspaces.find((candidate) => candidate.id === workspaceId);
	if (!workspace) throw new Error(`Unknown workspace: ${String(workspaceId)}`);
	if (workspace.kind === "default")
		throw new CodedError(
			"CONTAINER_MEMBER_REFUSED",
			"A project's Default workspace cannot join a container",
		);
	if (workspace.kind === "chat")
		throw new CodedError(
			"CONTAINER_MEMBER_REFUSED",
			"A chat without a project cannot join a container",
		);
	const holder = all.find((container) => container.workspaceIds.includes(workspace.id));
	if (holder)
		throw new CodedError(
			"CONTAINER_MEMBER_TAKEN",
			`${workspace.name} already belongs to the container ${holder.name}`,
		);
	return workspace;
}

function syncHome(container: Container): void {
	try {
		syncContainerHome(container, loadWorkspaces(), loadProjects());
	} catch (error) {
		log.warn(`the home of container ${container.id} could not be synced`, error);
	}
}

function commit(all: Container[], changed: Container): Container {
	saveContainers(all);
	syncHome(changed);
	publish?.({ kind: "updated", container: changed });
	return changed;
}

async function dissolve(all: readonly Container[], container: Container): Promise<void> {
	saveContainers(all.filter((candidate) => candidate.id !== container.id));
	publish?.({ kind: "removed", id: container.id });
	try {
		await beforeRetire?.(container);
	} catch (error) {
		log.warn(`the dissolve hook of container ${container.id} failed`, error);
	}
	try {
		await retireContainerHome(container.id);
	} catch (error) {
		log.warn(`the home of container ${container.id} could not be retired`, error);
	}
}

async function leave(
	all: Container[],
	container: Container,
	workspaceId: string,
): Promise<Container | null> {
	container.workspaceIds = container.workspaceIds.filter((id) => id !== workspaceId);
	if (container.workspaceIds.length === 0) {
		await dissolve(all, container);
		return null;
	}
	container.updatedAt = Date.now();
	return commit(all, container);
}

export function listContainers(): Container[] {
	return loadContainers().containers;
}

export function createContainer(params: { name?: string; workspaceIds: string[] }): Container {
	const all = writableContainers();
	const requested: unknown[] = Array.isArray(params.workspaceIds) ? params.workspaceIds : [];
	const workspaceIds = [...new Set(requested)];
	if (workspaceIds.length === 0)
		throw new CodedError("CONTAINER_EMPTY", "A container needs at least one workspace");
	const workspaces = loadWorkspaces();
	const members = workspaceIds.map((id) => admitMember(all, workspaces, id));
	const now = Date.now();
	const container: Container = {
		id: randomUUID(),
		name: displayName(params.name) ?? members[0]?.name ?? "",
		workspaceIds: members.map((member) => member.id),
		createdAt: now,
		updatedAt: now,
	};
	all.push(container);
	return commit(all, container);
}

export function renameContainer(containerId: string, name: string): Container {
	const all = writableContainers();
	const container = requireContainer(all, containerId);
	const next = displayName(name);
	if (next === null) throw new Error("A container name cannot be empty");
	if (next === container.name) return container;
	container.name = next;
	container.updatedAt = Date.now();
	return commit(all, container);
}

export function addContainerWorkspace(containerId: string, workspaceId: string): Container {
	const all = writableContainers();
	const container = requireContainer(all, containerId);
	if (container.workspaceIds.includes(workspaceId)) return container;
	admitMember(all, loadWorkspaces(), workspaceId);
	container.workspaceIds.push(workspaceId);
	container.updatedAt = Date.now();
	return commit(all, container);
}

/** The workspace becomes standalone; a container left without members is dissolved (`null`). */
export async function removeContainerWorkspace(
	containerId: string,
	workspaceId: string,
): Promise<Container | null> {
	const all = writableContainers();
	const container = requireContainer(all, containerId);
	if (!container.workspaceIds.includes(workspaceId)) return container;
	return leave(all, container, workspaceId);
}

/** Dissolves the record only: its members become standalone workspaces, untouched. */
export async function removeContainer(containerId: string): Promise<void> {
	const all = writableContainers();
	const container = all.find((candidate) => candidate.id === containerId);
	if (container) await dissolve(all, container);
}

/** An archived or removed workspace leaves its container; the record change happens before the first await. */
export async function forgetContainerMember(workspaceId: string): Promise<void> {
	const { containers } = loadContainers();
	const container = containers.find((candidate) => candidate.workspaceIds.includes(workspaceId));
	if (container) await leave(containers, container, workspaceId);
}

export function syncContainerMemberLinks(workspaceId: string): void {
	const container = listContainers().find((candidate) =>
		candidate.workspaceIds.includes(workspaceId),
	);
	if (container) syncHome(container);
}

/** The home, synced now; a home that cannot be made throws, unlike the best-effort sync after a change. */
export function prepareContainerHome(containerId: string): string {
	const container = requireContainer(listContainers(), containerId);
	syncContainerHome(container, loadWorkspaces(), loadProjects());
	return containerHome(container.id);
}

export function setContainerOrchestrator(containerId: string, sessionId: string): Container {
	const all = writableContainers();
	const container = requireContainer(all, containerId);
	if (container.orchestratorSessionId === sessionId) return container;
	container.orchestratorSessionId = sessionId;
	container.updatedAt = Date.now();
	return commit(all, container);
}

/** Its orchestrator chat was deleted; a container that is gone or has none is left alone. */
export function forgetContainerOrchestrator(containerId: string): void {
	const all = writableContainers();
	const container = all.find((candidate) => candidate.id === containerId);
	if (!container?.orchestratorSessionId) return;
	delete container.orchestratorSessionId;
	container.updatedAt = Date.now();
	commit(all, container);
}
