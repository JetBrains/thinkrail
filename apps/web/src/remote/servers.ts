import { compareProjectRank, type Project, WS_CHANNELS } from "@thinkrail/contracts";
import type {
	DeviceWireClient,
	HostConnectionStatus,
	HostRegistry,
	RemoteSessionsController,
	SavedHost,
} from "@thinkrail/remote-client";

/** A server's projects: not read yet, read, or the read failed (it is read again on the next connect). */
export type ServerProjects =
	| { kind: "loading" }
	| { kind: "ready"; projects: readonly Project[] }
	| { kind: "failed"; message: string };

export interface ServersSnapshot {
	/** Every saved server, in the order they were added. */
	servers: readonly SavedHost[];
	statuses: ReadonlyMap<string, HostConnectionStatus>;
	/** Each server's open projects, once its channel has opened. */
	projects: ReadonlyMap<string, ServerProjects>;
}

export interface ServersController {
	snapshot(): ServersSnapshot;
	subscribe(listener: () => void): () => void;
	/** Connects every saved server; later calls do nothing. */
	start(): void;
	/** Pairs a server by its `thinkrail://pair` link and saves it; rejects when the link or that pairing fails. */
	add(link: string): Promise<SavedHost>;
	/** Retries one server now, also one whose connection ended for good. */
	reconnect(hostKey: string): void;
	/** Retries every server that is down (the network came back). */
	reconnectAll(): void;
	/** Closes and forgets one server; pairing it again needs a new link. */
	forget(hostKey: string): void;
	clientFor(hostKey: string): DeviceWireClient | null;
}

const LOADING: ServerProjects = { kind: "loading" };

/** A server's open projects as the tree lists them: no Chats container, highest rank first. */
export function openProjects(projects: readonly Project[]): Project[] {
	return projects
		.filter((project) => project.kind !== "chats" && project.closed !== true)
		.sort(compareProjectRank);
}

/** The list after the server pushed one project: replaced or added, gone once closed. */
export function withProject(projects: readonly Project[], project: Project): Project[] {
	return openProjects([...projects.filter((candidate) => candidate.id !== project.id), project]);
}

/**
 * The IDE's saved servers: the registry they persist in, one connection each through `remoteSessions` (which
 * retries on its own), and each server's open projects — read when its channel first opens and again after
 * every reconnect, kept current by its `project.updated` pushes. The registry, the sessions controller and the
 * label this computer pairs under are injected, so it is unit-tested without a browser.
 */
export function createServers(deps: {
	registry: HostRegistry;
	sessions: RemoteSessionsController;
	label: string;
}): ServersController {
	const { registry, sessions, label } = deps;
	let servers: readonly SavedHost[] = registry.list();
	let projects: ReadonlyMap<string, ServerProjects> = new Map();
	let snapshot: ServersSnapshot | null = null;
	let started = false;
	const listeners = new Set<() => void>();
	/** The client each server's projects were read through; a new one (a re-pairing) is read again. */
	const watched = new Map<string, { client: DeviceWireClient; off: () => void; open: boolean }>();

	const notify = (): void => {
		snapshot = null;
		for (const listener of listeners) listener();
	};
	const setProjects = (hostKey: string, next: ServerProjects | null): void => {
		const map = new Map(projects);
		if (next) map.set(hostKey, next);
		else map.delete(hostKey);
		projects = map;
		notify();
	};
	const current = (hostKey: string, client: DeviceWireClient): boolean =>
		watched.get(hostKey)?.client === client;

	const read = (hostKey: string, client: DeviceWireClient): void => {
		if (!projects.has(hostKey)) setProjects(hostKey, LOADING);
		client.request<Project[]>("project.list", {}).then(
			(list) => {
				if (current(hostKey, client))
					setProjects(hostKey, { kind: "ready", projects: openProjects(list) });
			},
			(error: unknown) => {
				if (!current(hostKey, client)) return;
				if (projects.get(hostKey)?.kind === "ready") return;
				setProjects(hostKey, {
					kind: "failed",
					message: error instanceof Error ? error.message : String(error),
				});
			},
		);
	};

	const unwatch = (hostKey: string): void => {
		watched.get(hostKey)?.off();
		watched.delete(hostKey);
	};

	/** Follows the sessions controller: a server whose channel (re)opened is read; one gone is dropped. */
	const follow = (): void => {
		const { clients, statuses } = sessions.snapshot();
		for (const hostKey of [...watched.keys()]) {
			if (!clients.has(hostKey)) {
				unwatch(hostKey);
				if (projects.has(hostKey)) setProjects(hostKey, null);
			}
		}
		for (const [hostKey, client] of clients) {
			const open = statuses.get(hostKey)?.kind === "connected";
			const seen = watched.get(hostKey);
			if (seen?.client === client) {
				if (open && !seen.open) read(hostKey, client);
				seen.open = open;
				continue;
			}
			unwatch(hostKey);
			const off = client.subscribe(WS_CHANNELS.projectUpdated, (data) => {
				const shown = projects.get(hostKey);
				if (!current(hostKey, client) || shown?.kind !== "ready") return;
				setProjects(hostKey, {
					kind: "ready",
					projects: withProject(shown.projects, data as Project),
				});
			});
			watched.set(hostKey, { client, off, open });
			setProjects(hostKey, LOADING);
			if (open) read(hostKey, client);
		}
		notify();
	};
	sessions.subscribe(follow);
	sessions.onRoutes((host) => {
		servers = registry.update(host);
		notify();
	});

	return {
		snapshot() {
			if (snapshot) return snapshot;
			snapshot = { servers, statuses: sessions.snapshot().statuses, projects };
			return snapshot;
		},
		subscribe(listener) {
			listeners.add(listener);
			return () => void listeners.delete(listener);
		},
		start() {
			if (started) return;
			started = true;
			for (const server of servers) sessions.connect(server);
		},
		async add(link) {
			const host = await sessions.pair(link.trim(), { label });
			servers = registry.add(host);
			notify();
			return host;
		},
		reconnect(hostKey) {
			const server = servers.find((candidate) => candidate.hostKey === hostKey);
			if (server) sessions.connect(server);
		},
		reconnectAll() {
			sessions.reconnectNow();
		},
		forget(hostKey) {
			unwatch(hostKey);
			sessions.disconnect(hostKey);
			servers = registry.remove(hostKey);
			if (projects.has(hostKey)) setProjects(hostKey, null);
			else notify();
		},
		clientFor: (hostKey) => sessions.clientFor(hostKey),
	};
}
