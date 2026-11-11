import { describe, expect, test } from "bun:test";
import type { DeviceChannel } from "./deviceChannel";
import { createDeviceWireClient, RemoteRequestError } from "./deviceWireClient";

function fakeChannel() {
	const sent: Record<string, unknown>[] = [];
	let onMessage: (data: string) => void = () => {};
	let onClose: () => void = () => {};
	let open = true;
	const channel: DeviceChannel = {
		get open() {
			return open;
		},
		send: (data) => void sent.push(JSON.parse(data)),
		onMessage: (handler) => {
			onMessage = handler;
		},
		onClose: (handler) => {
			onClose = handler;
		},
		close: () => {
			open = false;
		},
	};
	return {
		channel,
		sent,
		deliver: (value: unknown) => onMessage(JSON.stringify(value)),
		drop: () => {
			open = false;
			onClose();
		},
	};
}

describe("createDeviceWireClient", () => {
	test("request ids are unique per client, so a restarted app never reuses one the host still holds", () => {
		const ids = [createDeviceWireClient(), createDeviceWireClient()].map((client) => {
			const io = fakeChannel();
			client.attach(io.channel);
			void client.request("session.list");
			return io.sent.at(-1)?.id;
		});
		expect(ids[0]).not.toBe(ids[1]);
	});

	test("a welcome that arrived before anyone subscribed reaches a later subscriber; event pushes do not", () => {
		const io = fakeChannel();
		const client = createDeviceWireClient();
		client.attach(io.channel);
		io.deliver({ channel: "server.welcome", data: { protocolVersion: 99 } });
		io.deliver({ channel: "pi.event", data: { sessionId: "s" } });
		const welcomes: unknown[] = [];
		const events: unknown[] = [];
		client.subscribe("server.welcome", (data) => welcomes.push(data));
		client.subscribe("pi.event", (data) => events.push(data));
		expect(welcomes).toEqual([{ protocolVersion: 99 }]);
		expect(events).toEqual([]);
	});

	test("sends a request and resolves with the matching result", async () => {
		const io = fakeChannel();
		const client = createDeviceWireClient();
		client.attach(io.channel);
		const result = client.request("project.list", { a: 1 });
		const id = io.sent.at(-1)?.id as string;
		expect(io.sent.at(-1)).toEqual({ id, method: "project.list", params: { a: 1 } });
		io.deliver({ id, ok: true, result: { items: [] } });
		await expect(result).resolves.toEqual({ items: [] });
		expect(io.sent.at(-1)).toEqual({ ack: [id] });
	});

	test("responses read together are acked in one frame", async () => {
		const io = fakeChannel();
		const client = createDeviceWireClient();
		client.attach(io.channel);
		const first = client.request("project.list");
		const firstId = io.sent.at(-1)?.id as string;
		const second = client.request("session.list");
		const secondId = io.sent.at(-1)?.id as string;
		io.deliver({ id: firstId, ok: true, result: 1 });
		io.deliver({ id: secondId, ok: false, error: "nope" });
		await Promise.allSettled([first, second]);
		expect(io.sent.filter((frame) => "ack" in frame)).toEqual([{ ack: [firstId, secondId] }]);
	});

	test("rejects with a RemoteRequestError carrying the error code", async () => {
		const io = fakeChannel();
		const client = createDeviceWireClient();
		client.attach(io.channel);
		const result = client.request("project.open");
		io.deliver({
			id: io.sent.at(-1)?.id,
			ok: false,
			error: "Not a git repository",
			errorCode: "NOT_GIT",
		});
		await expect(result).rejects.toBeInstanceOf(RemoteRequestError);
		await result.catch((err: RemoteRequestError) => {
			expect(err.message).toBe("Not a git repository");
			expect(err.code).toBe("NOT_GIT");
		});
	});

	test("a dropped channel does not fail requests; reattaching replays them and resolves", async () => {
		const first = fakeChannel();
		const client = createDeviceWireClient();
		client.attach(first.channel);
		const result = client.request("session.get");
		const id = first.sent.at(-1)?.id as string;

		first.drop();

		const second = fakeChannel();
		client.attach(second.channel);
		expect(second.sent).toEqual([{ resume: [id] }, { id, method: "session.get" }]);
		second.deliver({ id, ok: true, result: "ok" });
		await expect(result).resolves.toBe("ok");
	});

	test("routes pushes to subscribers across reconnects until unsubscribe", () => {
		const first = fakeChannel();
		const client = createDeviceWireClient();
		client.attach(first.channel);
		const seen: unknown[] = [];
		const unsubscribe = client.subscribe("pi.event", (data) => seen.push(data));

		first.deliver({ channel: "pi.event", data: { token: "a" } });
		first.drop();
		const second = fakeChannel();
		client.attach(second.channel);
		second.deliver({ channel: "pi.event", data: { token: "b" } });
		unsubscribe();
		second.deliver({ channel: "pi.event", data: { token: "c" } });

		expect(seen).toEqual([{ token: "a" }, { token: "b" }]);
	});

	test("close rejects every in-flight request", async () => {
		const io = fakeChannel();
		const client = createDeviceWireClient();
		client.attach(io.channel);
		const result = client.request("session.get");
		client.close();
		await expect(result).rejects.toBeInstanceOf(RemoteRequestError);
	});
});
