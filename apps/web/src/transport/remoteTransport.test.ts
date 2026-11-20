import { expect, test } from "bun:test";
import { type DeviceWireClient, RemoteRequestError } from "@thinkrail/remote-client";
import { RemoteTransport } from "./remoteTransport";
import { RequestTimeoutError, wsErrorCode } from "./requestError";

const clientAnswering = (answer: () => Promise<unknown>): DeviceWireClient => ({
	attach: () => {},
	request: <T>() => answer() as Promise<T>,
	subscribe: () => () => {},
	close: () => {},
});

/** A client whose requests wait until their signal aborts, counting the ones still held. */
function holdingClient(): { client: DeviceWireClient; held: () => number } {
	let held = 0;
	return {
		held: () => held,
		client: {
			attach: () => {},
			request: <T>(_method: string, _params?: unknown, options?: { signal?: AbortSignal }) =>
				new Promise<T>((_, reject) => {
					held += 1;
					options?.signal?.addEventListener("abort", () => {
						held -= 1;
						reject(options.signal?.reason);
					});
				}),
			subscribe: () => () => {},
			close: () => {},
		},
	};
}

test("a coded remote failure reads like the WS transport's, so code-based UI works on a remote host", async () => {
	const transport = new RemoteTransport(
		clientAnswering(() => Promise.reject(new RemoteRequestError("not a repo", "NOT_GIT"))),
		"K1",
	);
	const error = await transport.request("project.list", {}).catch((caught: unknown) => caught);
	expect(wsErrorCode(error)).toBe("NOT_GIT");
	expect((error as Error).message).toBe("not a repo");
});

test("an uncoded remote failure passes through", async () => {
	const failure = new RemoteRequestError("remote session closed");
	const transport = new RemoteTransport(
		clientAnswering(() => Promise.reject(failure)),
		"K1",
	);
	await expect(transport.request("project.list", {})).rejects.toBe(failure);
});

test("an explicit timeoutMs bounds the wait; without one a request waits for its answer", async () => {
	const never = new RemoteTransport(holdingClient().client, "K1");
	await expect(never.request("project.list", {}, { timeoutMs: 5 })).rejects.toBeInstanceOf(
		RequestTimeoutError,
	);
	const slow = new RemoteTransport(
		clientAnswering(() => new Promise((resolve) => setTimeout(() => resolve([]), 10))),
		"K1",
	);
	await expect(slow.request("project.list", {})).resolves.toEqual([]);
});

test("a timed-out request is dropped from the wire client, so a reconnect never replays it", async () => {
	const { client, held } = holdingClient();
	const transport = new RemoteTransport(client, "K1");
	await expect(transport.request("project.list", {}, { timeoutMs: 5 })).rejects.toBeInstanceOf(
		RequestTimeoutError,
	);
	expect(held()).toBe(0);
});

test("close rejects what is in flight and refuses new requests", async () => {
	const { client, held } = holdingClient();
	const transport = new RemoteTransport(client, "K1");
	const waiting = transport.request("project.list", {});
	transport.close();
	await expect(waiting).rejects.toBeInstanceOf(Error);
	expect(held()).toBe(0);
	await expect(transport.request("project.list", {})).rejects.toBeInstanceOf(Error);
	expect(held()).toBe(0);
});
