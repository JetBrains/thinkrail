import { describe, expect, test } from "bun:test";
import type { DeviceChannel } from "./deviceChannel";
import { createDeviceWireClient, RemoteRequestError } from "./deviceWireClient";

function fakeChannel() {
	const sent: Record<string, unknown>[] = [];
	let onMessage: (data: string) => void = () => {};
	let onClose: () => void = () => {};
	const channel: DeviceChannel = {
		open: true,
		send: (data) => void sent.push(JSON.parse(data)),
		onMessage: (handler) => {
			onMessage = handler;
		},
		onClose: (handler) => {
			onClose = handler;
		},
		close: () => {},
	};
	return {
		channel,
		sent,
		deliver: (value: unknown) => onMessage(JSON.stringify(value)),
		drop: () => onClose(),
	};
}

describe("createDeviceWireClient", () => {
	test("sends a request and resolves with the matching result", async () => {
		const io = fakeChannel();
		const client = createDeviceWireClient(io.channel);
		const result = client.request("project.list", { a: 1 });
		expect(io.sent).toEqual([{ id: "d1", method: "project.list", params: { a: 1 } }]);
		io.deliver({ id: "d1", ok: true, result: { items: [] } });
		await expect(result).resolves.toEqual({ items: [] });
	});

	test("rejects with a RemoteRequestError carrying the error code", async () => {
		const io = fakeChannel();
		const client = createDeviceWireClient(io.channel);
		const result = client.request("project.open");
		io.deliver({ id: "d1", ok: false, error: "Not a git repository", errorCode: "NOT_GIT" });
		await expect(result).rejects.toBeInstanceOf(RemoteRequestError);
		await result.catch((err: RemoteRequestError) => {
			expect(err.message).toBe("Not a git repository");
			expect(err.code).toBe("NOT_GIT");
		});
	});

	test("routes pushes to subscribers until they unsubscribe", () => {
		const io = fakeChannel();
		const client = createDeviceWireClient(io.channel);
		const seen: unknown[] = [];
		const unsubscribe = client.subscribe("pi.event", (data) => seen.push(data));

		io.deliver({ channel: "pi.event", data: { token: "a" } });
		io.deliver({ channel: "other", data: { token: "x" } });
		unsubscribe();
		io.deliver({ channel: "pi.event", data: { token: "b" } });

		expect(seen).toEqual([{ token: "a" }]);
	});

	test("a closed channel rejects every in-flight request", async () => {
		const io = fakeChannel();
		const client = createDeviceWireClient(io.channel);
		const result = client.request("session.get");
		io.drop();
		await expect(result).rejects.toBeInstanceOf(RemoteRequestError);
	});

	test("ignores malformed and unmatched frames", () => {
		const io = fakeChannel();
		createDeviceWireClient(io.channel);
		expect(() => {
			io.deliver("not-an-object");
			io.deliver({ id: "unknown", ok: true, result: 1 });
		}).not.toThrow();
	});
});
