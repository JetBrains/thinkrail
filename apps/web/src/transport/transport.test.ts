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

/**
 * The host cannot tell a reply that was read from one that died in a socket buffer, so it holds every result
 * until the page says it arrived. These receipts are the half of exactly-once the client owns: without them
 * the host must either keep every response forever or reclaim one the page is still about to replay for.
 */
describe("WsTransport response receipts", () => {
	const acksIn = (sent: readonly string[]): string[] =>
		sent.flatMap((frame) => (JSON.parse(frame) as { ack?: string[] }).ack ?? []);

	test("acknowledges each response, batching a burst into one frame", async () => {
		const transport = new WsTransport({ url: "ws://localhost:24242/ws" });
		transport.connect();
		const socket = TestWebSocket.instances[0];
		socket?.open();

		const first = transport.request("project.list", {});
		const second = transport.request("workspace.list", { projectId: "p1" });
		const ids = socket?.sent.map((frame) => (JSON.parse(frame) as { id: string }).id) ?? [];
		expect(ids).toHaveLength(2);

		socket?.message(JSON.stringify({ id: ids[0], ok: true, result: [] }));
		socket?.message(JSON.stringify({ id: ids[1], ok: true, result: [] }));
		await Promise.all([first, second]);
		await tick(0);

		expect(acksIn(socket?.sent ?? [])).toEqual(ids);
		// Both receipts rode one frame: two requests plus a single batched ack.
		expect(socket?.sent).toHaveLength(3);
	});

	test("a receipt the dead socket could not carry travels on the next one", async () => {
		const transport = new WsTransport({ url: "ws://localhost:24242/ws" });
		transport.connect();
		const first = TestWebSocket.instances[0];
		first?.open();

		const result = transport.request("project.list", {});
		const id = (JSON.parse(first?.sent[0] ?? "{}") as { id?: string }).id;
		// The reply lands and the socket dies before the batched receipt can flush.
		first?.message(JSON.stringify({ id, ok: true, result: [] }));
		first?.close();
		expect(await result).toEqual([]);
		expect(acksIn(first?.sent ?? [])).toEqual([]);

		await tick(520); // initial reconnect backoff
		const replacement = TestWebSocket.instances[1];
		replacement?.open();
		await tick(0);

		// Nothing to replay — the request resolved — but the host is still holding that result for it.
		expect(acksIn(replacement?.sent ?? [])).toEqual([id ?? ""]);
	});

	test("re-acknowledges a duplicate reply, whose first receipt may be what went missing", async () => {
		const transport = new WsTransport({ url: "ws://localhost:24242/ws" });
		transport.connect();
		const socket = TestWebSocket.instances[0];
		socket?.open();

		const result = transport.request("project.list", {});
		const id = (JSON.parse(socket?.sent[0] ?? "{}") as { id?: string }).id;
		socket?.message(JSON.stringify({ id, ok: true, result: [] }));
		expect(await result).toEqual([]);
		await tick(0);
		socket?.message(JSON.stringify({ id, ok: true, result: [] }));
		await tick(0);

		expect(acksIn(socket?.sent ?? [])).toEqual([id ?? "", id ?? ""]);
	});
});
