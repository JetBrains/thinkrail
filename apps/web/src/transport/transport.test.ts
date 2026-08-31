import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { WS_CHANNELS } from "@thinkrail/contracts";
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

interface ClientFrame {
	id?: string;
	method?: string;
	ack?: string[];
	resume?: string[];
}
const parse = (frame: string): ClientFrame => JSON.parse(frame) as ClientFrame;
const requestsIn = (sent: readonly string[]): ClientFrame[] =>
	sent.map(parse).filter((frame) => frame.method !== undefined);
const acksIn = (sent: readonly string[]): string[] =>
	sent.flatMap((frame) => parse(frame).ack ?? []);
const resumesIn = (sent: readonly string[]): string[][] =>
	sent.map(parse).flatMap((frame) => (frame.resume === undefined ? [] : [frame.resume]));

beforeEach(() => {
	TestWebSocket.instances = [];
	globalThis.WebSocket = TestWebSocket as unknown as typeof WebSocket;
});

afterEach(() => {
	globalThis.WebSocket = originalWebSocket;
});

describe("WsTransport channel replay", () => {
	test("does not replay a stale terminal takeover to a late terminal body", () => {
		const transport = new WsTransport({ url: "ws://localhost:24242/ws" });
		transport.connect();
		const socket = TestWebSocket.instances[0];
		socket?.open();
		socket?.message(
			JSON.stringify({
				channel: WS_CHANNELS.terminalDetached,
				data: { workspaceId: "w1", tabKey: "terminal-1" },
			}),
		);

		const received: unknown[] = [];
		transport.subscribe(WS_CHANNELS.terminalDetached, (payload) => received.push(payload));
		expect(received).toEqual([]);
	});

	test("does not replay a provider invalidation to a late settings pane", () => {
		const transport = new WsTransport({ url: "ws://localhost:24242/ws" });
		transport.connect();
		const socket = TestWebSocket.instances[0];
		socket?.open();
		socket?.message(JSON.stringify({ channel: WS_CHANNELS.providerChanged, data: {} }));

		const received: unknown[] = [];
		transport.subscribe(WS_CHANNELS.providerChanged, (payload) => received.push(payload));
		expect(received).toEqual([]);
	});
});

describe("WsTransport dispatch barriers", () => {
	test("runs the barrier before channel subscribers and response settlement", async () => {
		const order: string[] = [];
		const transport = new WsTransport(
			{ url: "ws://localhost:24242/ws" },
			{ beforeDispatch: () => order.push("barrier") },
		);
		transport.subscribe(WS_CHANNELS.projectUpdated, () => order.push("push"));
		transport.connect();
		const socket = TestWebSocket.instances[0];
		socket?.open();

		socket?.message(JSON.stringify({ channel: WS_CHANNELS.projectUpdated, data: {} }));
		expect(order).toEqual(["barrier", "push"]);

		order.length = 0;
		const result = transport.request("project.list", {}).then((value) => {
			order.push("response");
			return value;
		});
		const id = requestsIn(socket?.sent ?? [])[0]?.id;
		socket?.message(JSON.stringify({ id, ok: true, result: [] }));
		expect(await result).toEqual([]);
		expect(order).toEqual(["barrier", "response"]);
	});
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
		const originalFrame = first?.sent.find((frame) => parse(frame).method !== undefined);
		expect(originalFrame).toBeDefined();
		const id = parse(originalFrame ?? "{}").id;

		first?.close();
		await tick(20);
		expect(settled).toBe(false);

		await tick(520);
		const replacement = TestWebSocket.instances[1];
		expect(replacement).toBeDefined();
		replacement?.open();
		expect(replacement?.sent).toEqual([JSON.stringify({ resume: [id] }), originalFrame]);

		replacement?.message(JSON.stringify({ id, ok: true, result: [] }));
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

describe("WsTransport response receipts", () => {
	test("acknowledges each response, batching a burst into one frame", async () => {
		const transport = new WsTransport({ url: "ws://localhost:24242/ws" });
		transport.connect();
		const socket = TestWebSocket.instances[0];
		socket?.open();

		const first = transport.request("project.list", {});
		const second = transport.request("workspace.list", { projectId: "p1" });
		const ids = requestsIn(socket?.sent ?? []).map((frame) => frame.id ?? "");
		expect(ids).toHaveLength(2);
		const before = socket?.sent.length ?? 0;

		socket?.message(JSON.stringify({ id: ids[0], ok: true, result: [] }));
		socket?.message(JSON.stringify({ id: ids[1], ok: true, result: [] }));
		await Promise.all([first, second]);
		await tick(0);

		expect(acksIn(socket?.sent ?? [])).toEqual(ids);
		expect((socket?.sent.length ?? 0) - before).toBe(1);
	});

	test("a receipt lost with its socket is repaired by the reconnect reconciliation", async () => {
		const transport = new WsTransport({ url: "ws://localhost:24242/ws" });
		transport.connect();
		const first = TestWebSocket.instances[0];
		first?.open();

		const result = transport.request("project.list", {});
		const id = requestsIn(first?.sent ?? [])[0]?.id;
		first?.message(JSON.stringify({ id, ok: true, result: [] }));
		first?.close();
		expect(await result).toEqual([]);
		expect(acksIn(first?.sent ?? [])).toEqual([]);

		await tick(520);
		const replacement = TestWebSocket.instances[1];
		replacement?.open();
		await tick(0);

		expect(acksIn(replacement?.sent ?? [])).toEqual([]);
		expect(resumesIn(replacement?.sent ?? [])).toEqual([[]]);
	});

	test("the reconciliation names every unresolved id, including ones queued while offline", async () => {
		const transport = new WsTransport({ url: "ws://localhost:24242/ws" });
		transport.connect();
		const first = TestWebSocket.instances[0];
		first?.open();

		const resolved = transport.request("project.list", {});
		const stillOpen = transport.request("workspace.list", { projectId: "p1" });
		const [resolvedId, stillOpenId] = requestsIn(first?.sent ?? []).map((frame) => frame.id ?? "");
		first?.message(JSON.stringify({ id: resolvedId, ok: true, result: [] }));
		expect(await resolved).toEqual([]);
		first?.close();

		const queued = transport.request("git.status", { workspaceId: "w1" });
		await tick(520);
		const replacement = TestWebSocket.instances[1];
		replacement?.open();
		const queuedId = requestsIn(replacement?.sent ?? [])[1]?.id;

		expect(resumesIn(replacement?.sent ?? [])).toEqual([[stillOpenId, queuedId ?? ""]]);
		expect(resumesIn(replacement?.sent ?? [])[0]).not.toContain(resolvedId);

		replacement?.message(JSON.stringify({ id: stillOpenId, ok: true, result: [] }));
		replacement?.message(JSON.stringify({ id: queuedId, ok: true, result: { files: [] } }));
		await Promise.all([stillOpen, queued]);
	});

	test("re-acknowledges a duplicate reply, whose first receipt may be what went missing", async () => {
		const transport = new WsTransport({ url: "ws://localhost:24242/ws" });
		transport.connect();
		const socket = TestWebSocket.instances[0];
		socket?.open();

		const result = transport.request("project.list", {});
		const id = requestsIn(socket?.sent ?? [])[0]?.id;
		socket?.message(JSON.stringify({ id, ok: true, result: [] }));
		expect(await result).toEqual([]);
		await tick(0);
		socket?.message(JSON.stringify({ id, ok: true, result: [] }));
		await tick(0);

		expect(acksIn(socket?.sent ?? [])).toEqual([id ?? "", id ?? ""]);
	});
});
