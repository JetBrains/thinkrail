import { afterEach, beforeEach, expect, test } from "bun:test";
import {
	EXT_PROTOCOL_VERSION,
	type ExtensionInfo,
	WS_CHANNELS,
	type WsMethodName,
	type WsResult,
} from "@thinkrail/contracts";
import { useAppStore } from "../store";
import { useExtStore } from "./extStore";
import { type SyncTransport, startExtensionSync } from "./sync";

const info = (generation: number): ExtensionInfo => ({
	name: "demo",
	title: "Demo",
	scope: "user",
	status: "active",
	generation,
	build: `${generation}`.padStart(16, "0"),
	permissions: [],
	themes: [],
	surfaces: [],
});

const fakeTransport = () => {
	const handlers = new Map<string, (data: unknown) => void>();
	const pending: {
		method: WsMethodName;
		resolve: (value: unknown) => void;
		reject: (error: Error) => void;
	}[] = [];
	const take = (method: WsMethodName) => {
		const index = pending.findIndex((entry) => entry.method === method);
		return pending.splice(index, 1)[0];
	};
	return {
		push: (channel: string, data: unknown) => handlers.get(channel)?.(data),
		settle: (method: WsMethodName, value: unknown) => take(method)?.resolve(value),
		fail: (method: WsMethodName) => take(method)?.reject(new Error(`${method} failed`)),
		transport: {
			subscribe: (channel: string, handler: (data: unknown) => void) => {
				handlers.set(channel, handler);
				return () => {
					handlers.delete(channel);
				};
			},
			request: <M extends WsMethodName>(method: M) =>
				new Promise<WsResult<M>>((resolve, reject) =>
					pending.push({ method, resolve: (value) => resolve(value as WsResult<M>), reject }),
				),
		} satisfies SyncTransport,
	};
};

const welcome = (protocolVersion: number) =>
	useAppStore.setState((state) => ({
		protocolVersion,
		welcomeGeneration: state.welcomeGeneration + 1,
	}));

let stop: (() => void) | undefined;

beforeEach(() => {
	useExtStore.setState({ hydration: "idle", extensions: {}, channels: {}, params: {} });
});

afterEach(() => stop?.());

test("pushes that race the hydration read replay over the snapshot", async () => {
	const fake = fakeTransport();
	stop = startExtensionSync(fake.transport);
	welcome(EXT_PROTOCOL_VERSION);
	fake.push(WS_CHANNELS.extChanged, info(2));
	fake.push(WS_CHANNELS.extChannel, { key: "demo:count", value: 5 });
	expect(useExtStore.getState().hydration).toBe("idle");

	fake.settle("ext.list", [info(1)]);
	fake.settle("ext.snapshot", { "demo:count": 4 });
	await Bun.sleep(0);
	const state = useExtStore.getState();
	expect(state.hydration).toBe("ready");
	expect(state.extensions.demo?.generation).toBe(2);
	expect(state.channels).toEqual({ "demo:count": 5 });

	fake.push(WS_CHANNELS.extChannelsDropped, { name: "demo", keys: ["demo:count"] });
	expect(useExtStore.getState().channels).toEqual({});
});

test("an older host marks extensions unsupported without a request", () => {
	const fake = fakeTransport();
	stop = startExtensionSync(fake.transport);
	welcome(EXT_PROTOCOL_VERSION - 1);
	expect(useExtStore.getState().hydration).toBe("unsupported");
});

test("a failed hydration read leaves idle and still applies buffered pushes", async () => {
	const fake = fakeTransport();
	stop = startExtensionSync(fake.transport);
	welcome(EXT_PROTOCOL_VERSION);
	fake.push(WS_CHANNELS.extChanged, info(3));
	fake.fail("ext.list");
	fake.settle("ext.snapshot", {});
	await Bun.sleep(0);
	const state = useExtStore.getState();
	expect(state.hydration).toBe("failed");
	expect(state.extensions.demo?.generation).toBe(3);
});
