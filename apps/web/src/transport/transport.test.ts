import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { WsTransport } from "./transport";

class TestWebSocket {
	static readonly CONNECTING = 0;
	static readonly OPEN = 1;
	static readonly CLOSING = 2;
	static readonly CLOSED = 3;
	static instances: TestWebSocket[] = [];

	readonly url: string;
	readyState = TestWebSocket.CONNECTING;
	onopen: ((event: Event) => unknown) | null = null;
	onmessage: ((event: MessageEvent) => unknown) | null = null;
	onclose: ((event: CloseEvent) => unknown) | null = null;
	onerror: ((event: Event) => unknown) | null = null;
	readonly sent: string[] = [];

	constructor(url: string | URL) {
		this.url = String(url);
		TestWebSocket.instances.push(this);
	}

	open(): void {
		this.readyState = TestWebSocket.OPEN;
		this.onopen?.(new Event("open"));
	}

	send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void {
		if (this.readyState !== TestWebSocket.OPEN) throw new Error("socket is not open");
		if (typeof data !== "string") throw new Error("test socket expects text frames");
		this.sent.push(data);
	}

	message(data: string): void {
		this.onmessage?.(new MessageEvent("message", { data }));
	}

	close(): void {
		if (this.readyState === TestWebSocket.CLOSED) return;
		this.readyState = TestWebSocket.CLOSED;
		this.onclose?.(new CloseEvent("close"));
	}
}

const originalWebSocket = globalThis.WebSocket;
const tick = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

beforeEach(() => {
	TestWebSocket.instances = [];
	globalThis.WebSocket = TestWebSocket as unknown as typeof WebSocket;
});

afterEach(() => {
	globalThis.WebSocket = originalWebSocket;
});

describe("WsTransport reconnect delivery", () => {
	test("replays an unresolved frame under the same id and resolves from the replacement socket", async () => {
		const statuses: string[] = [];
		const transport = new WsTransport({
			url: "ws://localhost:24242/ws",
			onStatus: (status) => statuses.push(status),
		});
		const result = transport.request("project.list", {});
		let settled = false;
		void result.then(
			() => {
				settled = true;
			},
			() => {
				settled = true;
			},
		);

		transport.connect();
		const first = TestWebSocket.instances[0];
		expect(first).toBeDefined();
		first?.open();
		expect(first?.sent).toHaveLength(1);
		const originalFrame = first?.sent[0];
		expect(originalFrame).toBeDefined();

		first?.close();
		await tick(20);
		expect(settled).toBe(false); // disconnect is not reported as a false operation failure

		await tick(520); // initial reconnect backoff
		const replacement = TestWebSocket.instances[1];
		expect(replacement).toBeDefined();
		replacement?.open();
		expect(replacement?.sent).toEqual([originalFrame]);

		const request = JSON.parse(originalFrame ?? "{}") as { id?: string };
		replacement?.message(JSON.stringify({ id: request.id, ok: true, result: [] }));
		expect(await result).toEqual([]);
		expect(statuses).toEqual([
			"connecting",
			"connected",
			"disconnected",
			"connecting",
			"connected",
		]);
	});
});
