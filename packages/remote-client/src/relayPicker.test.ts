import { expect, test } from "bun:test";
import { openFirstRelay, type RelaySocket, RelayUnreachableError } from "./relayPicker";

class FakeSocket implements RelaySocket {
	closed = false;
	private listeners = new Map<string, Set<() => void>>();
	constructor(readonly url: string) {}
	addEventListener(type: string, listener: () => void): void {
		if (!this.listeners.has(type)) this.listeners.set(type, new Set());
		this.listeners.get(type)?.add(listener);
	}
	removeEventListener(type: string, listener: () => void): void {
		this.listeners.get(type)?.delete(listener);
	}
	emit(type: "open" | "error" | "close"): void {
		for (const listener of [...(this.listeners.get(type) ?? [])]) listener();
	}
	close(): void {
		this.closed = true;
	}
}

function harness() {
	const opened = new Map<string, FakeSocket>();
	const open = (url: string): FakeSocket => {
		const socket = new FakeSocket(url);
		opened.set(url, socket);
		return socket;
	};
	return { opened, open };
}

test("keeps the first address that connects and closes the others", async () => {
	const { opened, open } = harness();
	const picked = openFirstRelay(["ws://lan", "ws://tailscale"], open);
	opened.get("ws://tailscale")?.emit("open");
	const { url, socket } = await picked;
	expect(url).toBe("ws://tailscale");
	expect(socket.closed).toBe(false);
	expect(opened.get("ws://lan")?.closed).toBe(true);
});

test("a failing address does not block a later one", async () => {
	const { opened, open } = harness();
	const picked = openFirstRelay(["ws://lan", "ws://tailscale"], open);
	opened.get("ws://lan")?.emit("error");
	opened.get("ws://tailscale")?.emit("open");
	expect((await picked).url).toBe("ws://tailscale");
});

test("rejects with the tried addresses once every one fails", async () => {
	const { opened, open } = harness();
	const picked = openFirstRelay(["ws://lan", "ws://tailscale"], open);
	opened.get("ws://lan")?.emit("error");
	opened.get("ws://tailscale")?.emit("close");
	const error = await picked.catch((caught: unknown) => caught);
	expect(error).toBeInstanceOf(RelayUnreachableError);
	expect((error as RelayUnreachableError).urls).toEqual(["ws://lan", "ws://tailscale"]);
});

test("gives up after the timeout and closes the pending sockets", async () => {
	const { opened, open } = harness();
	const error = await openFirstRelay(["ws://silent"], open, 5).catch((caught: unknown) => caught);
	expect(error).toBeInstanceOf(RelayUnreachableError);
	expect(opened.get("ws://silent")?.closed).toBe(true);
});
