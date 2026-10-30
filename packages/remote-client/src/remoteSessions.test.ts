import { expect, test } from "bun:test";
import { type SessionState, type SessionStateRecord, WS_CHANNELS } from "@thinkrail/contracts";
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
	let closed = false;
	const client: DeviceWireClient = {
		attach: () => {},
		request<T>(method: string): Promise<T> {
			return Promise.resolve((method === "session.stateList" ? seed : null) as T);
		},
		subscribe: (channel, handler) => {
			if (channel === WS_CHANNELS.sessionState) onState = handler;
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
		projectRef: "",
		close: () => {
			closed = true;
		},
	};
	return {
		connection,
		pushState: (record: SessionStateRecord) => onState(record),
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
