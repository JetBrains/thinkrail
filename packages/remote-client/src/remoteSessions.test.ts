import { expect, test } from "bun:test";
import {
	type RemoteHostRoutes,
	type SessionState,
	type SessionStateRecord,
	WS_CHANNELS,
} from "@thinkrail/contracts";
import { RemoteConnectError } from "./connectError";
import type { RemoteConnection } from "./deviceConnector";
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
	let lost: (error: RemoteConnectError) => void = () => {};
	let openChange: (open: boolean) => void = () => {};
	let routes: (next: RemoteHostRoutes) => void = () => {};
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
		projectRef: "",
		onLost: (handler) => {
			lost = handler;
		},
		onOpenChange: (handler) => {
			openChange = handler;
		},
		onRoutes: (handler) => {
			routes = handler;
		},
		reconnectNow: () => {
			reconnects++;
		},
		close: () => {
			closed = true;
		},
	};
	return {
		connection,
		setOpen: (open: boolean) => openChange(open),
		pushRoutes: (next: RemoteHostRoutes) => routes(next),
		reconnects: () => reconnects,
		lose: (error: RemoteConnectError) => lost(error),
		pushState: (record: SessionStateRecord) => onState(record),
		pushAccess: (access: string) => onAccess({ access }),
		isClosed: () => closed,
	};
}

const laptop: SavedHost = { hostKey: "K1", relayUrl: "ws://r:1", label: "Laptop", pairedAt: 1 };
const server: SavedHost = { hostKey: "K2", relayUrl: "ws://r:2", label: "Server", pairedAt: 2 };

test("connects a host and seeds its sessions, tagged with host label", async () => {
	const fake = fakeConnection(laptop, [rec("s1"), rec("s2")]);
	const controller = createRemoteSessions(async () => fake.connection);
	await controller.connect(laptop);
	expect(controller.items().map((i) => ({ host: i.hostLabel, s: i.record.sessionId }))).toEqual([
		{ host: "Laptop", s: "s1" },
		{ host: "Laptop", s: "s2" },
	]);
});

test("aggregates sessions from several hosts and upserts on sessionState", async () => {
	const laptopConn = fakeConnection(laptop, [rec("s1")]);
	const serverConn = fakeConnection(server, [rec("s9")]);
	const controller = createRemoteSessions(async (h) =>
		h.hostKey === "K1" ? laptopConn.connection : serverConn.connection,
	);
	let notes = 0;
	controller.subscribe(() => notes++);

	await controller.connect(laptop);
	await controller.connect(server);
	expect(
		controller
			.items()
			.map((i) => i.record.sessionId)
			.sort(),
	).toEqual(["s1", "s9"]);

	laptopConn.pushState(rec("s2"));
	expect(
		controller
			.items()
			.filter((i) => i.hostKey === "K1")
			.map((i) => i.record.sessionId)
			.sort(),
	).toEqual(["s1", "s2"]);
	expect(notes).toBeGreaterThan(0);
});

test("connecting the same host twice is a no-op; stop closes every connection", async () => {
	const fake = fakeConnection(laptop, [rec("s1")]);
	let connects = 0;
	const controller = createRemoteSessions(async () => {
		connects++;
		return fake.connection;
	});
	await controller.connect(laptop);
	await controller.connect(laptop);
	expect(connects).toBe(1);
	controller.stop();
	expect(fake.isClosed()).toBe(true);
	expect(controller.items()).toEqual([]);
});

test("disconnect closes one host, drops its sessions and lets it connect again", async () => {
	const laptopFake = fakeConnection(laptop, [rec("s1")]);
	const serverFake = fakeConnection(server, [rec("s2")]);
	const controller = createRemoteSessions(async (host) =>
		host.hostKey === laptop.hostKey ? laptopFake.connection : serverFake.connection,
	);
	await controller.connect(laptop);
	await controller.connect(server);
	let notified = 0;
	controller.subscribe(() => notified++);

	controller.disconnect(laptop.hostKey);
	expect(laptopFake.isClosed()).toBe(true);
	expect(serverFake.isClosed()).toBe(false);
	expect(controller.clientFor(laptop.hostKey)).toBeNull();
	expect(controller.items().map((item) => item.record.sessionId)).toEqual(["s2"]);
	expect(notified).toBe(1);

	await controller.connect(laptop);
	expect(controller.clientFor(laptop.hostKey)).not.toBeNull();
});

test("a host lost for good is dropped with its sessions and reported to onLost listeners", async () => {
	const laptopFake = fakeConnection(laptop, [rec("s1")]);
	const serverFake = fakeConnection(server, [rec("s2")]);
	const fakes = new Map([
		[laptop.hostKey, laptopFake],
		[server.hostKey, serverFake],
	]);
	const controller = createRemoteSessions(async (host) => {
		const fake = fakes.get(host.hostKey);
		if (!fake) throw new Error("unknown host");
		return fake.connection;
	});
	await controller.connect(laptop);
	await controller.connect(server);
	const heard: [string, string][] = [];
	controller.onLost((hostKey, error) => heard.push([hostKey, error.code]));

	laptopFake.lose(new RemoteConnectError("unknown_device", "revoked"));
	expect(heard).toEqual([["K1", "unknown_device"]]);
	expect(controller.clientFor("K1")).toBeNull();
	expect(controller.items().map((item) => item.record.sessionId)).toEqual(["s2"]);
});

test("a host's access is write until it says read, and follows later changes", async () => {
	const fake = fakeConnection(laptop, []);
	const controller = createRemoteSessions(async () => fake.connection);
	await controller.connect(laptop);
	expect(controller.accessFor("K1")).toBe("write");
	fake.pushAccess("read");
	expect(controller.accessFor("K1")).toBe("read");
	fake.pushAccess("write");
	expect(controller.accessFor("K1")).toBe("write");
});

const until = async (check: () => boolean): Promise<void> => {
	const deadline = Date.now() + 2_000;
	while (!check() && Date.now() < deadline) await Bun.sleep(5);
};

test("a host that could not be reached is retried in the background until it connects", async () => {
	const fake = fakeConnection(laptop, [rec("s1")]);
	let calls = 0;
	const controller = createRemoteSessions(
		async () => {
			calls++;
			if (calls < 3) throw new RemoteConnectError("host_silent", "no answer");
			return fake.connection;
		},
		{ initialBackoffMs: 5, maxBackoffMs: 10 },
	);
	const misses: string[] = [];
	controller.onRetryFailed((hostKey) => misses.push(hostKey));
	await expect(controller.connect(laptop)).rejects.toBeInstanceOf(RemoteConnectError);
	await until(() => controller.clientFor("K1") !== null);
	expect(calls).toBe(3);
	expect(misses).toEqual(["K1"]);
	expect(controller.items().map((item) => item.record.sessionId)).toEqual(["s1"]);
	controller.stop();
});

test("a refusal no retry fixes is not retried", async () => {
	let calls = 0;
	const controller = createRemoteSessions(
		async () => {
			calls++;
			throw new RemoteConnectError("unknown_device", "revoked");
		},
		{ initialBackoffMs: 1, maxBackoffMs: 1 },
	);
	await expect(controller.connect(laptop)).rejects.toBeInstanceOf(RemoteConnectError);
	await Bun.sleep(30);
	expect(calls).toBe(1);
});

test("forgetting a host stops its background retry", async () => {
	let calls = 0;
	const controller = createRemoteSessions(
		async () => {
			calls++;
			throw new Error("offline");
		},
		{ initialBackoffMs: 5, maxBackoffMs: 5 },
	);
	await expect(controller.connect(laptop)).rejects.toThrow("offline");
	controller.disconnect("K1");
	await Bun.sleep(40);
	expect(calls).toBe(1);
});

test("reconnectNow skips the wait for a host that is down and pokes live connections", async () => {
	const live = fakeConnection(server, []);
	let laptopCalls = 0;
	const controller = createRemoteSessions(
		async (host) => {
			if (host.hostKey === server.hostKey) return live.connection;
			laptopCalls++;
			throw new Error("offline");
		},
		{ initialBackoffMs: 60_000, maxBackoffMs: 60_000 },
	);
	await controller.connect(server);
	await expect(controller.connect(laptop)).rejects.toThrow("offline");
	controller.reconnectNow();
	await until(() => laptopCalls === 2);
	expect(laptopCalls).toBe(2);
	expect(live.reconnects()).toBe(1);
	controller.stop();
});

test("a dropped channel shows as reconnecting until it is back", async () => {
	const fake = fakeConnection(laptop, []);
	const controller = createRemoteSessions(async () => fake.connection);
	await controller.connect(laptop);
	expect(controller.isReconnecting("K1")).toBe(false);
	fake.setOpen(false);
	expect(controller.isReconnecting("K1")).toBe(true);
	expect(controller.clientFor("K1")).not.toBeNull();
	fake.setOpen(true);
	expect(controller.isReconnecting("K1")).toBe(false);
});

test("routes the host sends are merged into the saved host, and later connects use them", async () => {
	const fake = fakeConnection(laptop, []);
	const dialed: SavedHost[] = [];
	const controller = createRemoteSessions(async (host) => {
		dialed.push(host);
		return fake.connection;
	});
	const saved: SavedHost[] = [];
	controller.onRoutes((host) => saved.push(host));
	await controller.connect({
		...laptop,
		nostr: { publicKey: "a".repeat(64), relays: ["wss://old"] },
	});
	const nostr = { publicKey: "b".repeat(64), relays: ["wss://relay.one"] };
	fake.pushRoutes({ signalingUrls: ["ws://10.0.0.9:1"], nostr });
	expect(saved).toEqual([
		{ ...laptop, relayUrl: "ws://10.0.0.9:1", relayUrls: ["ws://10.0.0.9:1"], nostr },
	]);

	fake.pushRoutes({ signalingUrls: ["ws://10.0.0.9:1"] });
	expect(saved[1]?.nostr).toBeUndefined();
});
