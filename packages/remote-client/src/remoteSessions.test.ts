import { expect, test } from "bun:test";
import {
	type RemoteHostRoutes,
	type SessionState,
	type SessionStateRecord,
	WS_CHANNELS,
} from "@thinkrail/contracts";
import { RemoteConnectError } from "./connectError";
import type { ConnectionEvents, RemoteConnection } from "./deviceConnector";
import type { DeviceWireClient } from "./deviceWireClient";
import type { SavedHost } from "./hostRegistry";
import { createRemoteSessions } from "./remoteSessions";

const idle: SessionState = {
	execution: "idle",
	runId: null,
	needsInput: null,
	completion: null,
	completionUnread: false,
	queuedCount: 0,
	backgroundWork: false,
};
const rec = (sessionId: string): SessionStateRecord => ({
	sessionId,
	workspaceId: "ws",
	projectId: "p",
	state: idle,
});

function fakeConnection(host: SavedHost, seed: SessionStateRecord[]) {
	let onState: (data: unknown) => void = () => {};
	let onAccess: (data: unknown) => void = () => {};
	let closed = false;
	let events: ConnectionEvents = {};
	let reconnects = 0;
	const client: DeviceWireClient = {
		attach: () => {},
		request<T>(method: string): Promise<T> {
			return Promise.resolve((method === "session.stateList" ? seed : null) as T);
		},
		subscribe: (channel, handler) => {
			if (channel === WS_CHANNELS.sessionState) onState = handler;
			if (channel === WS_CHANNELS.remoteDeviceAccess) onAccess = handler;
			return () => {};
		},
		close: () => {
			closed = true;
		},
	};
	const connection: RemoteConnection = {
		client,
		hostKey: host.hostKey,
		relayUrl: host.relayUrl,
		relayUrls: [host.relayUrl],
		reconnectNow: () => {
			reconnects++;
		},
		close: () => {
			closed = true;
		},
	};
	return {
		connection,
		/** The connector handing this connection out, keeping the events it was given. */
		connect: (_host: SavedHost, given: ConnectionEvents) => {
			events = given;
			return connection;
		},
		setOpen: (open: boolean) => events.onOpenChange?.(open),
		pushRoutes: (next: RemoteHostRoutes) => events.onRoutes?.(next),
		reconnects: () => reconnects,
		failRetry: (error: unknown) => events.onRetryFailed?.(error),
		lose: (error: RemoteConnectError) => events.onLost?.(error),
		pushState: (record: SessionStateRecord) => onState(record),
		pushAccess: (access: string) => onAccess({ access }),
		isClosed: () => closed,
	};
}

/** A connector over one fake per host. */
const over =
	(...fakes: ReturnType<typeof fakeConnection>[]) =>
	(host: SavedHost, events: ConnectionEvents): RemoteConnection => {
		const fake = fakes.find((candidate) => candidate.connection.hostKey === host.hostKey);
		if (!fake) throw new Error("unknown host");
		return fake.connect(host, events);
	};

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const laptop: SavedHost = { hostKey: "K1", relayUrl: "ws://r:1", label: "Laptop", pairedAt: 1 };
const server: SavedHost = { hostKey: "K2", relayUrl: "ws://r:2", label: "Server", pairedAt: 2 };

async function connected(...fakes: ReturnType<typeof fakeConnection>[]) {
	const controller = createRemoteSessions({ connect: over(...fakes) });
	for (const fake of fakes) {
		controller.connect({
			hostKey: fake.connection.hostKey,
			relayUrl: fake.connection.relayUrl,
			label: fake.connection.hostKey === "K1" ? "Laptop" : "Server",
			pairedAt: 0,
		});
		fake.setOpen(true);
	}
	await flush();
	return controller;
}

test("a host's client and sessions appear once its connection opens, tagged with the host label", async () => {
	const fake = fakeConnection(laptop, [rec("s1"), rec("s2")]);
	const controller = createRemoteSessions({ connect: over(fake) });
	controller.connect(laptop);
	expect(controller.clientFor("K1")).toBeNull();
	expect(controller.snapshot().statuses.get("K1")).toEqual({ kind: "connecting" });
	fake.setOpen(true);
	await flush();
	expect(controller.clientFor("K1")).toBe(fake.connection.client);
	expect(controller.snapshot().statuses.get("K1")).toEqual({ kind: "connected" });
	expect(
		controller.snapshot().items.map((i) => ({ host: i.hostLabel, s: i.record.sessionId })),
	).toEqual([
		{ host: "Laptop", s: "s1" },
		{ host: "Laptop", s: "s2" },
	]);
});

test("aggregates sessions from several hosts and upserts on sessionState", async () => {
	const laptopConn = fakeConnection(laptop, [rec("s1")]);
	const serverConn = fakeConnection(server, [rec("s9")]);
	const controller = await connected(laptopConn, serverConn);
	let notes = 0;
	controller.subscribe(() => notes++);
	expect(
		controller
			.snapshot()
			.items.map((i) => i.record.sessionId)
			.sort(),
	).toEqual(["s1", "s9"]);

	laptopConn.pushState(rec("s2"));
	expect(
		controller
			.snapshot()
			.items.filter((i) => i.hostKey === "K1")
			.map((i) => i.record.sessionId)
			.sort(),
	).toEqual(["s1", "s2"]);
	expect(notes).toBeGreaterThan(0);
});

test("the snapshot keeps its identity until the controller notifies, and its statuses until one changes", async () => {
	const fake = fakeConnection(laptop, [rec("s1")]);
	const controller = await connected(fake);
	const first = controller.snapshot();
	expect(controller.snapshot()).toBe(first);
	expect(first.clients.get("K1")).toBe(fake.connection.client);
	expect(first.access.get("K1")).toBe("write");
	fake.pushAccess("read");
	const second = controller.snapshot();
	expect(second).not.toBe(first);
	expect(second.access.get("K1")).toBe("read");
	expect(second.statuses).toBe(first.statuses);
	fake.setOpen(false);
	expect(controller.snapshot().statuses).not.toBe(first.statuses);
});

test("connecting a tracked host again retries it instead of opening a second; stop closes every connection", async () => {
	const fake = fakeConnection(laptop, [rec("s1")]);
	let connects = 0;
	const controller = createRemoteSessions({
		connect: (host, events) => {
			connects++;
			return fake.connect(host, events);
		},
	});
	controller.connect(laptop);
	controller.connect(laptop);
	expect(connects).toBe(1);
	expect(fake.reconnects()).toBe(1);
	controller.stop();
	expect(fake.isClosed()).toBe(true);
	expect(controller.snapshot().items).toEqual([]);
});

test("disconnect closes one host, drops its sessions and status and lets it connect again", async () => {
	const laptopFake = fakeConnection(laptop, [rec("s1")]);
	const serverFake = fakeConnection(server, [rec("s2")]);
	const controller = await connected(laptopFake, serverFake);
	let notified = 0;
	controller.subscribe(() => notified++);

	controller.disconnect(laptop.hostKey);
	expect(laptopFake.isClosed()).toBe(true);
	expect(serverFake.isClosed()).toBe(false);
	expect(controller.clientFor(laptop.hostKey)).toBeNull();
	expect(controller.snapshot().statuses.has(laptop.hostKey)).toBe(false);
	expect(controller.snapshot().items.map((item) => item.record.sessionId)).toEqual(["s2"]);
	expect(notified).toBe(1);

	controller.connect(laptop);
	laptopFake.setOpen(true);
	expect(controller.clientFor(laptop.hostKey)).not.toBeNull();
});

test("a host lost for good is dropped with its sessions, keeps the refusal as its status and is reported", async () => {
	const laptopFake = fakeConnection(laptop, [rec("s1")]);
	const serverFake = fakeConnection(server, [rec("s2")]);
	const controller = await connected(laptopFake, serverFake);
	const heard: [string, string][] = [];
	controller.onLost((hostKey, error) => heard.push([hostKey, error.code]));

	const revoked = new RemoteConnectError("unknown_device", "revoked");
	laptopFake.lose(revoked);
	expect(heard).toEqual([["K1", "unknown_device"]]);
	expect(controller.clientFor("K1")).toBeNull();
	expect(controller.snapshot().statuses.get("K1")).toEqual({ kind: "unreachable", error: revoked });
	expect(controller.snapshot().items.map((item) => item.record.sessionId)).toEqual(["s2"]);
});

test("a host's access is write until it says read, and follows later changes", async () => {
	const fake = fakeConnection(laptop, []);
	const controller = await connected(fake);
	expect(controller.accessFor("K1")).toBe("write");
	fake.pushAccess("read");
	expect(controller.accessFor("K1")).toBe("read");
	fake.pushAccess("write");
	expect(controller.accessFor("K1")).toBe("write");
});

test("a failed attempt shows as unreachable with its error until the connection opens", async () => {
	const fake = fakeConnection(laptop, [rec("s1")]);
	const controller = createRemoteSessions({ connect: over(fake) });
	controller.connect(laptop);
	const miss = new RemoteConnectError("host_silent", "no answer");
	fake.failRetry(miss);
	expect(controller.snapshot().statuses.get("K1")).toEqual({ kind: "unreachable", error: miss });
	expect(controller.clientFor("K1")).toBeNull();
	fake.setOpen(true);
	expect(controller.snapshot().statuses.get("K1")).toEqual({ kind: "connected" });
});

test("a dropped channel reads connecting, then the failed retry, and connected once back", async () => {
	const fake = fakeConnection(laptop, []);
	const controller = await connected(fake);
	fake.setOpen(false);
	expect(controller.snapshot().statuses.get("K1")).toEqual({ kind: "connecting" });
	expect(controller.clientFor("K1")).not.toBeNull();
	fake.failRetry(new RemoteConnectError("no_direct_route", "timed out"));
	expect(controller.snapshot().statuses.get("K1")?.kind).toBe("unreachable");
	fake.setOpen(true);
	expect(controller.snapshot().statuses.get("K1")).toEqual({ kind: "connected" });
});

test("connecting a host that is down clears its failure and retries it now; an open one stays connected", async () => {
	const fake = fakeConnection(laptop, []);
	const controller = await connected(fake);
	controller.connect(laptop);
	expect(controller.snapshot().statuses.get("K1")).toEqual({ kind: "connected" });
	fake.setOpen(false);
	fake.failRetry(new Error("offline"));
	controller.connect(laptop);
	expect(controller.snapshot().statuses.get("K1")).toEqual({ kind: "connecting" });
	expect(fake.reconnects()).toBe(2);
});

test("reconnectNow retries every tracked host", async () => {
	const laptopFake = fakeConnection(laptop, []);
	const serverFake = fakeConnection(server, []);
	const controller = createRemoteSessions({ connect: over(laptopFake, serverFake) });
	controller.connect(laptop);
	controller.connect(server);
	serverFake.setOpen(true);
	controller.reconnectNow();
	expect([laptopFake.reconnects(), serverFake.reconnects()]).toEqual([1, 1]);
});

test("routes the host sends are merged into the saved host, and later connects use them", async () => {
	const fake = fakeConnection(laptop, []);
	const controller = createRemoteSessions({ connect: over(fake) });
	const saved: SavedHost[] = [];
	controller.onRoutes((host) => saved.push(host));
	controller.connect({ ...laptop, nostr: { publicKey: "a".repeat(64), relays: ["wss://old"] } });
	const nostr = { publicKey: "b".repeat(64), relays: ["wss://relay.one"] };
	fake.pushRoutes({ signalingUrls: ["ws://10.0.0.9:1"], nostr });
	expect(saved).toEqual([
		{ ...laptop, relayUrl: "ws://10.0.0.9:1", relayUrls: ["ws://10.0.0.9:1"], nostr },
	]);

	fake.pushRoutes({ signalingUrls: ["ws://10.0.0.9:1"] });
	expect(saved[1]?.nostr).toBeUndefined();
});

test("a disconnected host's late reports change nothing", async () => {
	const fake = fakeConnection(laptop, [rec("s1")]);
	const controller = createRemoteSessions({ connect: over(fake) });
	controller.connect(laptop);
	controller.disconnect("K1");
	let notes = 0;
	controller.subscribe(() => notes++);
	const lost: string[] = [];
	controller.onLost((hostKey) => lost.push(hostKey));
	fake.setOpen(true);
	fake.failRetry(new Error("offline"));
	fake.lose(new RemoteConnectError("unknown_device", "revoked"));
	await flush();
	expect(notes).toBe(0);
	expect(lost).toEqual([]);
	expect(controller.clientFor("K1")).toBeNull();
	expect(controller.snapshot().statuses.has("K1")).toBe(false);
});

const paired = (fake: ReturnType<typeof fakeConnection>, hostName?: string) => ({
	pair: async (_link: string, events: ConnectionEvents) => {
		fake.connect(laptop, events);
		return hostName ? { ...fake.connection, hostName } : fake.connection;
	},
});

test("pairing tracks the connection that paired, connected, with no second handshake", async () => {
	const fake = fakeConnection(laptop, [rec("s1")]);
	let dials = 0;
	const controller = createRemoteSessions({
		connect: () => {
			dials++;
			return fake.connection;
		},
		...paired(fake, "Studio"),
	});
	const host = await controller.pair("thinkrail://pair?…", { label: "iPhone" });
	await flush();
	expect(dials).toBe(0);
	expect(host).toMatchObject({ hostKey: "K1", relayUrl: "ws://r:1", label: "Studio" });
	expect(controller.clientFor("K1")).toBe(fake.connection.client);
	expect(controller.snapshot().statuses.get("K1")).toEqual({ kind: "connected" });
	expect(controller.snapshot().items.map((item) => item.record.sessionId)).toEqual(["s1"]);
	fake.setOpen(false);
	expect(controller.snapshot().statuses.get("K1")).toEqual({ kind: "connecting" });
});

test("a link that sent no name is named by its address; pairing again replaces the old connection", async () => {
	const first = fakeConnection(laptop, []);
	const second = fakeConnection(laptop, []);
	const fakes = [first, second];
	const controller = createRemoteSessions({
		pair: async (_link, events) => {
			const fake = fakes.shift();
			if (!fake) throw new Error("unexpected pairing");
			fake.connect(laptop, events);
			return fake.connection;
		},
	});
	expect((await controller.pair("link", { label: "iPhone" })).label).toBe("r:1");
	await controller.pair("link", { label: "iPhone" });
	expect(first.isClosed()).toBe(true);
	expect(controller.clientFor("K1")).toBe(second.connection.client);
	first.lose(new RemoteConnectError("unknown_device", "revoked"));
	expect(controller.clientFor("K1")).toBe(second.connection.client);
});

test("a failed pairing rejects and tracks nothing", async () => {
	const controller = createRemoteSessions({
		pair: () => Promise.reject(new RemoteConnectError("code_expired", "expired")),
	});
	await expect(controller.pair("link", { label: "iPhone" })).rejects.toBeInstanceOf(
		RemoteConnectError,
	);
	expect(controller.snapshot().statuses.size).toBe(0);
});

test("a controller stopped and connected again works (a remounted app), and a pairing landing after stop is closed", async () => {
	const fake = fakeConnection(laptop, []);
	let landPairing: (connection: RemoteConnection) => void = () => {};
	const controller = createRemoteSessions({
		connect: over(fake),
		pair: () => new Promise((resolve) => (landPairing = resolve)),
	});
	const pairing = controller.pair("link", { label: "iPhone" });
	controller.stop();
	const late = fakeConnection(server, []);
	landPairing(late.connection);
	await expect(pairing).rejects.toThrow();
	expect(late.isClosed()).toBe(true);
	controller.connect(laptop);
	fake.setOpen(true);
	expect(controller.clientFor("K1")).toBe(fake.connection.client);
});
