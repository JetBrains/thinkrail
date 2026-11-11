import { expect, test } from "bun:test";
import type { RemoteConnection } from "@thinkrail/remote-client";
import { createRemoteConnectionController } from "./remoteConnection";

const LINK = "thinkrail://pair?v=1&s=ws://relay:1&t=tok&k=KEY&p=proj";

function connection(): RemoteConnection {
	return {
		client: {
			attach: () => {},
			request: () => Promise.reject(new Error("not used")),
			subscribe: () => () => {},
			close: () => {},
		},
		hostKey: "KEY",
		relayUrl: "ws://relay:1",
		relayUrls: ["ws://relay:1"],
		reconnectNow: () => {},
		close: () => {},
	};
}

test("rejects an invalid link without calling the connector", async () => {
	let called = false;
	const controller = createRemoteConnectionController(async () => {
		called = true;
		return connection();
	});
	await controller.connect("not a link", "Phone");
	expect(controller.getState()).toEqual({ status: "error", kind: "invalid-link" });
	expect(called).toBe(false);
});

test("transitions idle → connecting → connected and notifies subscribers", async () => {
	const states: string[] = [];
	const controller = createRemoteConnectionController(async () => connection());
	controller.subscribe(() => states.push(controller.getState().status));
	await controller.connect(LINK, "Phone");
	expect(states).toEqual(["connecting", "connected"]);
	const state = controller.getState();
	expect(state.status === "connected" && state.connection.hostKey).toBe("KEY");
});

test("surfaces a connector failure as an error state", async () => {
	const controller = createRemoteConnectionController(async () => {
		throw new Error("relay connection failed");
	});
	await controller.connect(LINK, "Phone");
	expect(controller.getState()).toEqual({
		status: "error",
		kind: "failed",
		message: "relay connection failed",
	});
	controller.reset();
	expect(controller.getState()).toEqual({ status: "idle" });
});

function deferred() {
	let resolve: (value: RemoteConnection) => void = () => {};
	let reject: (error: unknown) => void = () => {};
	const promise = new Promise<RemoteConnection>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

function closable() {
	const state = { closed: false };
	const close = (): void => {
		state.closed = true;
	};
	return { connection: { ...connection(), close }, state };
}

test("a connect that lands after reset is closed and does not overwrite idle", async () => {
	const pending = deferred();
	const controller = createRemoteConnectionController(() => pending.promise);
	const connecting = controller.connect(LINK, "Phone");
	controller.reset();
	const late = closable();
	pending.resolve(late.connection);
	await connecting;
	expect(controller.getState()).toEqual({ status: "idle" });
	expect(late.state.closed).toBe(true);
});

test("a failure that lands after reset does not overwrite idle", async () => {
	const pending = deferred();
	const controller = createRemoteConnectionController(() => pending.promise);
	const connecting = controller.connect(LINK, "Phone");
	controller.reset();
	pending.reject(new Error("timed out"));
	await connecting;
	expect(controller.getState()).toEqual({ status: "idle" });
});

test("only the newest connect wins; an older one finishing later is closed", async () => {
	const attempts = [deferred(), deferred()];
	let call = 0;
	const controller = createRemoteConnectionController(
		() => attempts[call++]?.promise ?? Promise.reject(new Error("unexpected")),
	);
	const first = controller.connect(LINK, "Phone");
	const second = controller.connect(LINK, "Phone");
	const newer = closable();
	const older = closable();
	attempts[1]?.resolve(newer.connection);
	await second;
	attempts[0]?.resolve(older.connection);
	await first;
	const state = controller.getState();
	expect(state.status === "connected" && state.connection).toBe(newer.connection);
	expect(older.state.closed).toBe(true);
	expect(newer.state.closed).toBe(false);
});
