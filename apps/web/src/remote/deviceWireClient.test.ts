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
	test("sends a request and resolves with the matching result", async () => {
		const io = fakeChannel();
		const client = createDeviceWireClient();
		client.attach(io.channel);
		const result = client.request("project.list", { a: 1 });
		expect(io.sent).toEqual([{ id: "d1", method: "project.list", params: { a: 1 } }]);
		io.deliver({ id: "d1", ok: true, result: { items: [] } });
		await expect(result).resolves.toEqual({ items: [] });
	});

	test("rejects with a RemoteRequestError carrying the error code", async () => {
		const io = fakeChannel();
		const client = createDeviceWireClient();
		client.attach(io.channel);
		const result = client.request("project.open");
		io.deliver({ id: "d1", ok: false, error: "Not a git repository", errorCode: "NOT_GIT" });
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
		expect(first.sent).toHaveLength(1);

		first.drop(); // network flap — request must survive

		const second = fakeChannel();
		client.attach(second.channel);
		expect(second.sent).toEqual([{ id: "d1", method: "session.get" }]); // replayed
		second.deliver({ id: "d1", ok: true, result: "ok" });
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
