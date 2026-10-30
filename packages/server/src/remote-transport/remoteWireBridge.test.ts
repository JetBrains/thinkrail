import { expect, test } from "bun:test";
import type { RemoteChannel } from "./channel";
import { bridgeRemoteWire, type WireDispatch } from "./remoteWireBridge";

function fakeChannel() {
	const sent: unknown[] = [];
	let onMessage: (bytes: Uint8Array) => void = () => {};
	const channel: RemoteChannel = {
		open: true,
		send: (bytes) => void sent.push(JSON.parse(new TextDecoder().decode(bytes))),
		onMessage: (handler) => {
			onMessage = handler;
		},
		onClose: () => {},
		close: () => {},
	};
	const deliver = (value: unknown): void =>
		onMessage(new TextEncoder().encode(typeof value === "string" ? value : JSON.stringify(value)));
	return { channel, sent, deliver };
}

async function flush(): Promise<void> {
	await Promise.resolve();
	await Promise.resolve();
}

test("dispatches a request and replies with the ok framing", async () => {
	const { channel, sent, deliver } = fakeChannel();
	const calls: { method: string; params: unknown; clientKey: string }[] = [];
	const dispatch: WireDispatch = async (method, params, ctx) => {
		calls.push({ method, params, clientKey: ctx.clientKey });
		return { echoed: params };
	};
	bridgeRemoteWire(channel, { clientKey: "device-1", dispatch });

	deliver({ id: "r1", method: "project.list", params: { a: 1 } });
	await flush();

	expect(calls).toEqual([{ method: "project.list", params: { a: 1 }, clientKey: "device-1" }]);
	expect(sent).toEqual([{ id: "r1", ok: true, result: { echoed: { a: 1 } } }]);
});

test("a dispatch failure replies with error and an optional code", async () => {
	const { channel, sent, deliver } = fakeChannel();
	const dispatch: WireDispatch = async () => {
		throw new Error("nope");
	};
	bridgeRemoteWire(channel, { clientKey: "d", dispatch, errorCodeOf: () => "NOT_GIT" });

	deliver({ id: "r2", method: "project.open" });
	await flush();

	expect(sent).toEqual([{ id: "r2", ok: false, error: "nope", errorCode: "NOT_GIT" }]);
});

test("non-request frames are ignored", async () => {
	const { channel, sent, deliver } = fakeChannel();
	bridgeRemoteWire(channel, { clientKey: "d", dispatch: async () => null });
	deliver("not json");
	deliver({ id: "x" });
	deliver({ method: "m" });
	await flush();
	expect(sent).toEqual([]);
});

test("push frames a channel event", () => {
	const { channel, sent } = fakeChannel();
	const bridge = bridgeRemoteWire(channel, { clientKey: "d", dispatch: async () => null });
	bridge.push("pi.event", { token: "hi" });
	expect(sent).toEqual([{ channel: "pi.event", data: { token: "hi" } }]);
});
