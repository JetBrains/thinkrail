import { expect, test } from "bun:test";
import { type Project, WS_CHANNELS } from "@thinkrail/contracts";
import {
	createHostRegistry,
	type DeviceWireClient,
	type HostConnectionStatus,
	type RemoteSessionsController,
	type RemoteSessionsSnapshot,
	type SavedHost,
} from "@thinkrail/remote-client";
import { computerLabel } from "./appServers";
import { createServers, openProjects, withProject } from "./servers";

const project = (id: string, rank: number, extra: Partial<Project> = {}): Project => ({
	id,
	name: id,
	path: `/srv/${id}`,
	slug: id,
	lastOpened: rank,
	...extra,
});

const host = (hostKey: string): SavedHost => ({
	hostKey,
	relayUrl: `ws://${hostKey}:24243`,
	label: hostKey,
	pairedAt: 1,
});

function memoryStore() {
	const values = new Map<string, string>();
	return {
		read: (key: string) => values.get(key) ?? null,
		write: (key: string, value: string) => void values.set(key, value),
	};
}

/** A client whose `project.list` answers what the test sets, and whose pushes the test sends. */
function fakeClient(list: () => Project[] | Error) {
	const handlers = new Map<string, (data: unknown) => void>();
	let reads = 0;
	const client: DeviceWireClient = {
		attach: () => {},
		request<T>(method: string): Promise<T> {
			if (method !== "project.list") return Promise.reject(new Error(method));
			reads += 1;
			const answer = list();
			return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer as T);
		},
		subscribe: (channel, handler) => {
			handlers.set(channel, handler);
			return () => handlers.delete(channel);
		},
		close: () => {},
	};
	return {
		client,
		push: (channel: string, data: unknown) => handlers.get(channel)?.(data),
		reads: () => reads,
	};
}

/** A stand-in for `remoteSessions`: the test opens and drops each host's channel. */
function fakeSessions() {
	const listeners = new Set<() => void>();
	const routeListeners = new Set<(host: SavedHost) => void>();
	let statuses = new Map<string, HostConnectionStatus>();
	let clients = new Map<string, DeviceWireClient>();
	const connected: string[] = [];
	const disconnected: string[] = [];
	let paired: { link: string; label: string } | null = null;
	const notify = () => {
		for (const listener of listeners) listener();
	};
	const controller: RemoteSessionsController = {
		connect: (saved) => void connected.push(saved.hostKey),
		pair: async (link, options) => {
			paired = { link, label: options.label };
			return host("paired");
		},
		snapshot: (): RemoteSessionsSnapshot => ({ items: [], statuses, clients, access: new Map() }),
		clientFor: (hostKey) => clients.get(hostKey) ?? null,
		welcomeFor: () => null,
		accessFor: () => "write",
		subscribe: (listener) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		onLost: () => () => {},
		onRoutes: (listener) => {
			routeListeners.add(listener);
			return () => routeListeners.delete(listener);
		},
		reconnectNow: () => {},
		disconnect: (hostKey) => void disconnected.push(hostKey),
		stop: () => {},
	};
	return {
		controller,
		connected,
		disconnected,
		paired: () => paired,
		set(hostKey: string, status: HostConnectionStatus, client?: DeviceWireClient) {
			statuses = new Map(statuses).set(hostKey, status);
			if (client) clients = new Map(clients).set(hostKey, client);
			notify();
		},
		drop(hostKey: string) {
			const nextClients = new Map(clients);
			nextClients.delete(hostKey);
			clients = nextClients;
			notify();
		},
		routes: (saved: SavedHost) => {
			for (const listener of routeListeners) listener(saved);
		},
	};
}

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function setup(saved: SavedHost[] = []) {
	const registry = createHostRegistry(memoryStore());
	for (const server of saved) registry.add(server);
	const sessions = fakeSessions();
	const servers = createServers({ registry, sessions: sessions.controller, label: "Mac" });
	return { registry, sessions, servers };
}

test("a server's open projects drop the Chats container and closed ones, highest rank first", () => {
	expect(
		openProjects([
			project("old", 1),
			project("chats", 9, { kind: "chats" }),
			project("new", 5),
			project("gone", 7, { closed: true }),
		]).map((p) => p.id),
	).toEqual(["new", "old"]);
	const list = [project("a", 2), project("b", 1)];
	expect(withProject(list, project("b", 3)).map((p) => p.id)).toEqual(["b", "a"]);
	expect(withProject(list, project("a", 2, { closed: true })).map((p) => p.id)).toEqual(["b"]);
	expect(withProject(list, project("c", 0)).map((p) => p.id)).toEqual(["a", "b", "c"]);
});

test("start connects every saved server once", () => {
	const { sessions, servers } = setup([host("one"), host("two")]);
	servers.start();
	servers.start();
	expect(sessions.connected).toEqual(["one", "two"]);
	expect(servers.snapshot().servers.map((s) => s.hostKey)).toEqual(["one", "two"]);
});

test("a server's projects load when its channel opens and again after a reconnect", async () => {
	const { sessions, servers } = setup([host("one")]);
	let answer: Project[] = [project("api", 2), project("infra", 1)];
	const fake = fakeClient(() => answer);
	sessions.set("one", { kind: "connecting" }, fake.client);
	expect(servers.snapshot().projects.get("one")).toEqual({ kind: "loading" });
	expect(fake.reads()).toBe(0);

	sessions.set("one", { kind: "connected" });
	await tick();
	expect(servers.snapshot().projects.get("one")).toEqual({
		kind: "ready",
		projects: [project("api", 2), project("infra", 1)],
	});

	answer = [project("infra", 1)];
	sessions.set("one", { kind: "connecting" });
	sessions.set("one", { kind: "connected" });
	await tick();
	expect(fake.reads()).toBe(2);
	expect(servers.snapshot().projects.get("one")).toEqual({
		kind: "ready",
		projects: [project("infra", 1)],
	});
});

test("a pushed project updates the list; a failed re-read keeps the projects already shown", async () => {
	const { sessions, servers } = setup([host("one")]);
	let answer: Project[] | Error = [project("api", 2)];
	const fake = fakeClient(() => answer);
	sessions.set("one", { kind: "connected" }, fake.client);
	await tick();
	fake.push(WS_CHANNELS.projectUpdated, project("web", 3));
	expect(servers.snapshot().projects.get("one")).toEqual({
		kind: "ready",
		projects: [project("web", 3), project("api", 2)],
	});

	answer = new Error("timeout");
	sessions.set("one", { kind: "connecting" });
	sessions.set("one", { kind: "connected" });
	await tick();
	expect(servers.snapshot().projects.get("one")?.kind).toBe("ready");
});

test("a first read that fails says why", async () => {
	const { sessions, servers } = setup([host("one")]);
	sessions.set("one", { kind: "connected" }, fakeClient(() => new Error("denied")).client);
	await tick();
	expect(servers.snapshot().projects.get("one")).toEqual({ kind: "failed", message: "denied" });
});

test("an answer from a client the server no longer uses is ignored", async () => {
	const { sessions, servers } = setup([host("one")]);
	let release: (list: Project[]) => void = () => {};
	const stale: DeviceWireClient = {
		...fakeClient(() => []).client,
		request: <T>() => new Promise<T>((resolve) => (release = resolve as typeof release)),
	};
	sessions.set("one", { kind: "connected" }, stale);
	sessions.drop("one");
	release([project("stale", 1)]);
	await tick();
	expect(servers.snapshot().projects.has("one")).toBe(false);
});

test("adding pairs under this computer's name and saves the server; routes it sends are saved too", async () => {
	const { registry, sessions, servers } = setup();
	const added = await servers.add("  thinkrail://pair?v=1  ");
	expect(sessions.paired()).toEqual({ link: "thinkrail://pair?v=1", label: "Mac" });
	expect(added.hostKey).toBe("paired");
	expect(servers.snapshot().servers.map((s) => s.hostKey)).toEqual(["paired"]);

	sessions.routes({ ...host("paired"), relayUrls: ["ws://10.0.0.2:24243"] });
	expect(registry.list()[0]?.relayUrls).toEqual(["ws://10.0.0.2:24243"]);
	expect(servers.snapshot().servers[0]?.relayUrls).toEqual(["ws://10.0.0.2:24243"]);
});

test("reconnect asks for the saved server again; forget closes it and drops it and its projects", async () => {
	const { registry, sessions, servers } = setup([host("one"), host("two")]);
	servers.reconnect("one");
	servers.reconnect("unknown");
	expect(sessions.connected).toEqual(["one"]);

	sessions.set("one", { kind: "connected" }, fakeClient(() => [project("api", 1)]).client);
	await tick();
	servers.forget("one");
	expect(sessions.disconnected).toEqual(["one"]);
	expect(registry.list().map((s) => s.hostKey)).toEqual(["two"]);
	expect(servers.snapshot().projects.has("one")).toBe(false);
});

test("this computer names itself by its platform", () => {
	expect(computerLabel("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)")).toBe("Mac");
	expect(computerLabel("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")).toBe("Windows PC");
	expect(computerLabel("Mozilla/5.0 (X11; Linux x86_64)")).toBe("Linux PC");
	expect(computerLabel("")).toBe("Computer");
});
