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

test("with a replay, a request re-sent after a reconnect replies from the first run, and ack/resume reach it", async () => {
	const { channel, sent, deliver } = fakeChannel();
	const runs = new Map<string, Promise<string>>();
	const acked: string[][] = [];
	const retained: string[][] = [];
	let executed = 0;
	bridgeRemoteWire(channel, {
		clientKey: "d",
		dispatch: async () => ++executed,
		replay: {
			run: (id, _method, _params, execute) => {
				const known = runs.get(id) ?? execute();
				runs.set(id, known);
				return known;
			},
			acknowledge: (ids) => void acked.push([...ids]),
			retain: (ids) => void retained.push([...ids]),
		},
	});

	deliver({ resume: [] });
	deliver({ id: "a:1", method: "session.prompt", params: { text: "hi" } });
	deliver({ id: "a:1", method: "session.prompt", params: { text: "hi" } });
	await flush();
	expect(executed).toBe(1);
	expect(sent).toEqual([
		{ id: "a:1", ok: true, result: 1 },
		{ id: "a:1", ok: true, result: 1 },
	]);

	deliver({ ack: ["a:1", 7] });
	deliver({ resume: ["a:2"] });
	expect(acked).toEqual([["a:1"]]);
	expect(retained).toEqual([[], ["a:2"]]);
});

test("an app that never sent resume is served without the replay", async () => {
	const { channel, sent, deliver } = fakeChannel();
	let runs = 0;
	bridgeRemoteWire(channel, {
		clientKey: "d",
		dispatch: async () => "ok",
		replay: {
			run: async (_id, _method, _params, execute) => {
				runs += 1;
				return execute();
			},
			acknowledge: () => {},
			retain: () => {},
		},
	});
	deliver({ id: "d1", method: "session.list" });
	await flush();
	expect(runs).toBe(0);
	expect(sent).toEqual([{ id: "d1", ok: true, result: "ok" }]);
});

test("a replay refusal (a reused id, a full namespace) replies as a failure and is reported", async () => {
	const { channel, sent, deliver } = fakeChannel();
	const reported: string[] = [];
	bridgeRemoteWire(channel, {
		clientKey: "d",
		dispatch: async () => null,
		onError: (_error, method) => void reported.push(method),
		errorCodeOf: () => "REQUEST_REPLAY_OVERFLOW",
		replay: {
			run: async () => {
				throw new Error("full");
			},
			acknowledge: () => {},
			retain: () => {},
		},
	});
	deliver({ resume: [] });
	deliver({ id: "a:1", method: "session.list" });
	await flush();
	await flush();
	expect(sent).toEqual([
		{ id: "a:1", ok: false, error: "full", errorCode: "REQUEST_REPLAY_OVERFLOW" },
	]);
	expect(reported).toEqual(["session.list"]);
});

test("pushFramed sends an already framed broadcast as is", () => {
	const { channel, sent } = fakeChannel();
	bridgeRemoteWire(channel, { clientKey: "d", dispatch: async () => null }).pushFramed(
		JSON.stringify({ channel: "pi.event", data: 1 }),
	);
	expect(sent).toEqual([{ channel: "pi.event", data: 1 }]);
});
