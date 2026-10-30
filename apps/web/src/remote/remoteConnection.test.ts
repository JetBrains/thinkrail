import { expect, test } from "bun:test";
import type { RemoteConnection } from "./deviceConnector";
import { createRemoteConnectionController } from "./remoteConnection";

const LINK = "thinkrail://pair?v=1&s=ws://relay:1&t=tok&k=KEY&p=proj";

function connection(): RemoteConnection {
	return {
		client: { request: async () => null, subscribe: () => () => {}, close: () => {} },
		projectRef: "proj",
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
	expect(controller.getState()).toEqual({
		status: "error",
		message: "That is not a valid ThinkRail pairing link.",
	});
	expect(called).toBe(false);
});

test("transitions idle → connecting → connected and notifies subscribers", async () => {
	const states: string[] = [];
	const controller = createRemoteConnectionController(async () => connection());
	controller.subscribe(() => states.push(controller.getState().status));
	await controller.connect(LINK, "Phone");
	expect(states).toEqual(["connecting", "connected"]);
	const state = controller.getState();
	expect(state.status === "connected" && state.connection.projectRef).toBe("proj");
});

test("surfaces a connector failure as an error state", async () => {
	const controller = createRemoteConnectionController(async () => {
		throw new Error("relay connection failed");
	});
	await controller.connect(LINK, "Phone");
	expect(controller.getState()).toEqual({ status: "error", message: "relay connection failed" });
	controller.reset();
	expect(controller.getState()).toEqual({ status: "idle" });
});
