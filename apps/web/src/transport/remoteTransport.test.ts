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
	const never = new RemoteTransport(
		clientAnswering(() => new Promise(() => {})),
		"K1",
	);
	await expect(never.request("project.list", {}, { timeoutMs: 5 })).rejects.toBeInstanceOf(
		RequestTimeoutError,
	);
	const slow = new RemoteTransport(
		clientAnswering(() => new Promise((resolve) => setTimeout(() => resolve([]), 10))),
		"K1",
	);
	await expect(slow.request("project.list", {})).resolves.toEqual([]);
});
