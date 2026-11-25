import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { PROTOCOL_VERSION, WS_CHANNELS, WS_MAX_FRAME_BYTES } from "@thinkrail/contracts";
import { RequestTimeoutError, wsErrorCode } from "./requestError";
import { reconnectDelay, WsTransport } from "./transport";

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

test("advertises the client protocol version in the WebSocket handshake", () => {
	const transport = new WsTransport({ url: "ws://localhost:24242/ws?existing=value" });
	transport.connect();
	const socketUrl = new URL(TestWebSocket.instances[0]?.url ?? "");
	expect(socketUrl.searchParams.get("existing")).toBe("value");
	expect(socketUrl.searchParams.get("protocol")).toBe(String(PROTOCOL_VERSION));
	expect(socketUrl.searchParams.get("client")).toStartWith("client-");
});

describe("WsTransport channel replay", () => {
	test.each([
		[
			"resource invalidations deliver live but are not replayed on remount",
			WS_CHANNELS.sessionResourcesChanged,
			{ workspaceId: "workspace", sessionId: "session" },
		],
		[
			"does not replay a stale terminal takeover to a late terminal body",
			WS_CHANNELS.terminalDetached,
			{ workspaceId: "w1", tabKey: "terminal-1" },
		],
		[
			"does not replay a provider invalidation to a late settings pane",
			WS_CHANNELS.providerChanged,
			{},
		],
		[
			"does not replay an addressed survey invitation to a late subscriber",
			WS_CHANNELS.feedbackInterview,
			{},
		],
		[
			"does not replay the addressed GitHub star ask to a late subscriber",
			WS_CHANNELS.feedbackGithubStar,
			{},
		],
		[
			"does not replay a Find in Files batch to a late subscriber",
			WS_CHANNELS.searchTextResults,
			{ seq: 1, files: [], done: { reason: "complete", files: 0, lines: 0 } },
		],
	])("%s", (_name, channel, data) => {
		const transport = new WsTransport({ url: "ws://localhost:24242/ws" });
		transport.connect();
		const socket = TestWebSocket.instances[0];
		socket?.open();
		const received: unknown[] = [];
		transport.subscribe(channel, (payload) => received.push(payload));
		socket?.message(JSON.stringify({ channel, data }));
		expect(received).toEqual([data]);
		const replay: unknown[] = [];
		transport.subscribe(channel, (payload) => replay.push(payload));
		expect(replay).toEqual([]);
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
		expect(replacement?.sent).toEqual([JSON.stringify({ resume: [id] }), originalFrame ?? ""]);

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

		expect(resumesIn(replacement?.sent ?? [])).toEqual([[stillOpenId ?? "", queuedId ?? ""]]);
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

	test("a request that times out is released to the host and left out of the next reconciliation", async () => {
		const transport = new WsTransport({ url: "ws://localhost:24242/ws" });
		transport.connect();
		const first = TestWebSocket.instances[0];
		first?.open();

		const result = transport.request("project.list", {}, { timeoutMs: 10 });
		const id = requestsIn(first?.sent ?? [])[0]?.id ?? "";
		await expect(result).rejects.toThrow();
		await tick(0);
		expect(acksIn(first?.sent ?? [])).toEqual([id]);

		first?.close();
		await tick(520);
		const replacement = TestWebSocket.instances[1];
		replacement?.open();
		expect(resumesIn(replacement?.sent ?? [])).toEqual([[]]);
		expect(requestsIn(replacement?.sent ?? [])).toEqual([]);
	});
});

describe("WsTransport frame cap", () => {
	const envelopeBytes = JSON.stringify({
		id: "trpi_1",
		method: "session.prompt",
		params: { sessionId: "s1", text: "" },
	}).length;
	const utf8Bytes = (frame: string) => new TextEncoder().encode(frame).byteLength;

	test("sends a frame exactly at the cap", async () => {
		const transport = new WsTransport({ url: "ws://localhost:24242/ws" });
		transport.connect();
		const socket = TestWebSocket.instances[0];
		socket?.open();

		const text = "a".repeat(WS_MAX_FRAME_BYTES - envelopeBytes);
		const result = transport.request("session.prompt", { sessionId: "s1", text });
		const frame = socket?.sent.at(-1) ?? "";
		expect(utf8Bytes(frame)).toBe(WS_MAX_FRAME_BYTES);
		expect(parse(frame).id).toBe("trpi_1");

		socket?.message(JSON.stringify({ id: "trpi_1", ok: true, result: { ok: true } }));
		expect(await result).toEqual({ ok: true });
	});

	test.each([
		["one byte over the cap", "a".repeat(WS_MAX_FRAME_BYTES - envelopeBytes + 1)],
		[
			"over the cap in UTF-8 though under it in UTF-16 code units",
			"ж".repeat(Math.floor((WS_MAX_FRAME_BYTES - envelopeBytes) / 2) + 1),
		],
	])("rejects a frame %s without sending or replaying it", async (_name, text) => {
		const transport = new WsTransport({ url: "ws://localhost:24242/ws" });
		transport.connect();
		const first = TestWebSocket.instances[0];
		first?.open();

		const error = await transport.request("session.prompt", { sessionId: "s1", text }).then(
			() => undefined,
			(err: unknown) => err,
		);
		expect(wsErrorCode(error)).toBe("FRAME_TOO_LARGE");
		expect(requestsIn(first?.sent ?? [])).toEqual([]);

		first?.close();
		await tick(520);
		const replacement = TestWebSocket.instances[1];
		replacement?.open();
		expect(replacement?.sent).toEqual([JSON.stringify({ resume: [] })]);
	});
});

describe("reconnectDelay", () => {
	test("a connection that keeps dying fast backs off to the 10 s cap instead of retrying every 0.5 s", () => {
		const waits: number[] = [];
		let delay = 500;
		for (let attempt = 0; attempt < 8; attempt++) {
			const { waitMs, nextMs } = reconnectDelay(delay, 2_000);
			waits.push(waitMs);
			delay = nextMs;
		}
		expect(waits).toEqual([500, 1_000, 2_000, 4_000, 8_000, 10_000, 10_000, 10_000]);
	});

	test("a connect that never opens keeps doubling", () => {
		expect(reconnectDelay(4_000, null)).toEqual({ waitMs: 4_000, nextMs: 8_000 });
	});

	test("a connection that stayed up for 5 s retries after 0.5 s again", () => {
		expect(reconnectDelay(10_000, 5_000)).toEqual({ waitMs: 500, nextMs: 1_000 });
		expect(reconnectDelay(10_000, 4_999)).toEqual({ waitMs: 10_000, nextMs: 10_000 });
	});
});

function testSocket(index = 0): TestWebSocket {
	const socket = TestWebSocket.instances[index];
	if (!socket) throw new Error(`Missing test socket ${index}`);
	return socket;
}

async function answerQueuedRequests(socket: TestWebSocket): Promise<void> {
	const answered = new Set<string>();
	for (;;) {
		const requests = requestsIn(socket.sent).filter((frame) => !answered.has(frame.id ?? ""));
		if (requests.length === 0) return;
		for (const frame of requests) {
			answered.add(frame.id ?? "");
			socket.message(
				JSON.stringify({
					id: frame.id,
					ok: true,
					result: frame.method === "session.abort" ? { ok: true } : [],
				}),
			);
		}
		await tick(0);
	}
}

function trackHostOccupancy(socket: TestWebSocket): () => number {
	const held = new Set<string>();
	let peak = 0;
	const send = socket.send.bind(socket);
	socket.send = (data) => {
		send(data);
		if (typeof data !== "string") return;
		const frame = parse(data);
		if (frame.method && frame.id) held.add(frame.id);
		for (const id of frame.ack ?? []) held.delete(id);
		peak = Math.max(peak, held.size);
	};
	return () => peak;
}

describe("WsTransport admission", () => {
	test.each(["ordinary", "control"] as const)(
		"late timers cannot admit an expired queued %s request",
		async (lane) => {
			const callbacks: (() => void)[] = [];
			const setTimer = globalThis.setTimeout;
			const timers = spyOn(globalThis, "setTimeout").mockImplementation(
				Object.assign((...args: Parameters<typeof setTimeout>) => {
					const timer = setTimer(...args);
					const [callback, , ...callbackArgs] = args;
					callbacks.push(() => {
						clearTimeout(timer);
						callback(...callbackArgs);
					});
					return timer;
				}, setTimer),
			);
			const clock = spyOn(performance, "now").mockReturnValue(1_000);
			try {
				const transport = new WsTransport({ url: "ws://localhost:24242/ws" });
				transport.connect();
				const socket = testSocket();
				socket.open();
				const count = lane === "ordinary" ? 256 : 32;
				const held = Array.from({ length: count }, () =>
					lane === "ordinary"
						? transport.request("project.list", {}, { timeoutMs: 10 })
						: transport.request("terminal.write", { id: "term", data: "held" }, { timeoutMs: 10 }),
				);
				const request = (timeoutMs: number) =>
					lane === "ordinary"
						? transport.request(
								"session.followUp",
								{ sessionId: "session", text: "continue" },
								{ timeoutMs },
							)
						: transport.request("terminal.write", { id: "term", data: "queued" }, { timeoutMs });
				const expired = request(20);
				const current = request(60_000);
				const results = Promise.allSettled([...held, expired, current]);
				clock.mockReturnValue(1_030);
				callbacks[0]?.();
				const admitted = requestsIn(socket.sent);
				for (const callback of callbacks) callback();
				const outcomes = await results;
				expect(outcomes[count]).toMatchObject({
					status: "rejected",
					reason: expect.any(RequestTimeoutError),
				});
				expect(admitted.some((frame) => frame.id === `trpi_${count + 1}`)).toBe(false);
				expect(admitted.at(-1)?.id).toBe(`trpi_${count + 2}`);
				expect(acksIn(socket.sent)).not.toContain(`trpi_${count + 1}`);
			} finally {
				for (const callback of callbacks) callback();
				timers.mockRestore();
				clock.mockRestore();
			}
		},
	);

	test("reconnect discards overdue unsent work before reconciliation and admission", async () => {
		const clock = spyOn(performance, "now").mockReturnValue(1_000);
		try {
			const transport = new WsTransport({ url: "ws://localhost:24242/ws" });
			transport.connect();
			const first = testSocket();
			first.open();
			first.close();
			const expired = transport.request(
				"session.followUp",
				{ sessionId: "session", text: "expired" },
				{ timeoutMs: 60_000 },
			);
			const expiredResult = expired.catch((error: unknown) => error);
			const current = transport.request("project.list", {}, { timeoutMs: 120_000 });
			await tick(520);
			clock.mockReturnValue(61_000);
			const replacement = testSocket(1);
			replacement.open();
			const reconciled = resumesIn(replacement.sent);
			const admitted = requestsIn(replacement.sent);
			await answerQueuedRequests(replacement);
			expect(await current).toEqual([]);
			expect(await expiredResult).toBeInstanceOf(RequestTimeoutError);
			expect(reconciled).toEqual([["trpi_2"]]);
			expect(admitted.map((frame) => frame.id)).toEqual(["trpi_2"]);
			expect(acksIn(replacement.sent)).toEqual(["trpi_2"]);
		} finally {
			clock.mockRestore();
		}
	});

	test("a burst stays below the host replay ceiling and every caller receives its result", async () => {
		const transport = new WsTransport({ url: "ws://localhost:24242/ws" });
		transport.connect();
		const socket = testSocket();
		socket.open();
		const peak = trackHostOccupancy(socket);
		const results = Array.from({ length: 600 }, () => transport.request("project.list", {}));
		const admitted = requestsIn(socket.sent).length;
		await answerQueuedRequests(socket);
		expect(await Promise.all(results)).toEqual(Array.from({ length: 600 }, () => []));
		expect(admitted).toBeGreaterThan(0);
		expect(admitted).toBeLessThan(512);
		expect(peak()).toBeLessThan(512);
		expect(new Set(requestsIn(socket.sent).map((frame) => frame.id)).size).toBe(600);
	});

	test("Stop has its own bounded window while ordinary requests are held", async () => {
		const transport = new WsTransport({ url: "ws://localhost:24242/ws" });
		transport.connect();
		const socket = testSocket();
		socket.open();
		const peak = trackHostOccupancy(socket);
		const reads = Array.from({ length: 600 }, () => transport.request("project.list", {}));
		const stops = Array.from({ length: 90 }, () =>
			transport.request("session.abort", { sessionId: "s1" }),
		);
		const admitted = requestsIn(socket.sent);
		await answerQueuedRequests(socket);
		await Promise.all([...reads, ...stops]);
		const stopCount = admitted.filter((frame) => frame.method === "session.abort").length;
		expect(admitted.filter((frame) => frame.method === "project.list").length).toBeLessThan(600);
		expect(stopCount).toBeGreaterThan(0);
		expect(stopCount).toBeLessThan(90);
		expect(peak()).toBeLessThan(512);
	});

	test.each(["clone", "follow-up", "steer"] as const)(
		"control traffic preserves queued %s initiation order",
		async (kind) => {
			const transport = new WsTransport({ url: "ws://localhost:24242/ws" });
			transport.connect();
			const socket = testSocket();
			socket.open();
			const reads = Array.from({ length: 600 }, () => transport.request("project.list", {}));
			const operation =
				kind === "clone"
					? transport.request("project.clone", {
							operationId: "clone",
							url: "local-fixture",
							parentPath: "/fixture",
							name: "repo",
						})
					: transport.request(kind === "follow-up" ? "session.followUp" : "session.steer", {
							sessionId: "session",
							text: "continue",
						});
			const control =
				kind === "clone"
					? transport.request("project.cancelClone", { operationId: "clone" })
					: transport.request("session.abort", { sessionId: "session", restoreQueue: true });
			const early = requestsIn(socket.sent).filter((frame) => frame.method !== "project.list");
			await answerQueuedRequests(socket);
			await Promise.all([...reads, operation, control]);
			expect(early).toEqual([]);
			expect(
				requestsIn(socket.sent)
					.filter((frame) => frame.method !== "project.list")
					.map((frame) => frame.method),
			).toEqual(
				kind === "clone"
					? ["project.clone", "project.cancelClone"]
					: [kind === "follow-up" ? "session.followUp" : "session.steer", "session.abort"],
			);
		},
	);

	test("a full control window cannot move a later follow-up ahead of Stop", async () => {
		const transport = new WsTransport({ url: "ws://localhost:24242/ws" });
		transport.connect();
		const socket = testSocket();
		socket.open();
		const stops = Array.from({ length: 90 }, () =>
			transport.request("session.abort", { sessionId: "session", restoreQueue: true }),
		);
		const followUp = transport.request("session.followUp", {
			sessionId: "session",
			text: "new continuation",
		});
		const early = requestsIn(socket.sent).some((frame) => frame.method === "session.followUp");
		await answerQueuedRequests(socket);
		await Promise.all([...stops, followUp]);
		expect(early).toBe(false);
		expect(requestsIn(socket.sent).at(-1)?.method).toBe("session.followUp");
	});

	test("reconnect preserves a queued clone and cancellation behind replayed reads", async () => {
		const transport = new WsTransport({ url: "ws://localhost:24242/ws" });
		transport.connect();
		const first = testSocket();
		first.open();
		const reads = Array.from({ length: 600 }, () => transport.request("project.list", {}));
		const clone = transport.request("project.clone", {
			operationId: "clone",
			url: "local-fixture",
			parentPath: "/fixture",
			name: "repo",
		});
		first.close();
		const cancel = transport.request("project.cancelClone", { operationId: "clone" });
		await tick(520);
		const replacement = testSocket(1);
		replacement.open();
		const early = requestsIn(replacement.sent).filter((frame) => frame.method !== "project.list");
		await answerQueuedRequests(replacement);
		await Promise.all([...reads, clone, cancel]);
		expect(early).toEqual([]);
		expect(resumesIn(replacement.sent)[0]).toHaveLength(602);
		expect(
			requestsIn(replacement.sent)
				.filter((frame) => frame.method !== "project.list")
				.map((frame) => frame.method),
		).toEqual(["project.clone", "project.cancelClone"]);
	});

	test("a queued mutation deadline removes the ordering barrier for later Stop", async () => {
		const transport = new WsTransport({ url: "ws://localhost:24242/ws" });
		transport.connect();
		const socket = testSocket();
		socket.open();
		const reads = Array.from({ length: 600 }, () => transport.request("project.list", {}));
		const expired = transport.request(
			"session.followUp",
			{ sessionId: "session", text: "continue" },
			{ timeoutMs: 10 },
		);
		const stop = transport.request("session.abort", { sessionId: "session", restoreQueue: true });
		const early = requestsIn(socket.sent).some((frame) => frame.method === "session.abort");
		await expect(expired).rejects.toThrow();
		const afterDeadline = requestsIn(socket.sent).some((frame) => frame.method === "session.abort");
		await answerQueuedRequests(socket);
		await Promise.all([...reads, stop]);
		expect(early).toBe(false);
		expect(afterDeadline).toBe(true);
		expect(requestsIn(socket.sent).some((frame) => frame.method === "session.followUp")).toBe(
			false,
		);
	});

	test("a queued deadline expires without sending the request or acknowledging unstarted work", async () => {
		const transport = new WsTransport({ url: "ws://localhost:24242/ws" });
		transport.connect();
		const socket = testSocket();
		socket.open();
		const reads = Array.from({ length: 600 }, () => transport.request("project.list", {}));
		const expired = transport.request(
			"workspace.list",
			{ projectId: "expired" },
			{ timeoutMs: 10 },
		);
		await expect(expired).rejects.toThrow();
		await answerQueuedRequests(socket);
		await Promise.all(reads);
		expect(requestsIn(socket.sent).some((frame) => frame.method === "workspace.list")).toBe(false);
		expect(acksIn(socket.sent)).toHaveLength(600);
	});

	test("a sent deadline releases a slot only after its abandonment receipt", async () => {
		const transport = new WsTransport({ url: "ws://localhost:24242/ws" });
		transport.connect();
		const socket = testSocket();
		socket.open();
		const expired = transport.request(
			"workspace.list",
			{ projectId: "expired" },
			{ timeoutMs: 10 },
		);
		const reads = Array.from({ length: 600 }, () => transport.request("project.list", {}));
		const before = requestsIn(socket.sent).length;
		await expect(expired).rejects.toThrow();
		await tick(0);
		const after = requestsIn(socket.sent).length;
		const receiptIndex = socket.sent.findIndex((frame) => parse(frame).ack?.includes("trpi_1"));
		const replacementIndex = socket.sent.findIndex(
			(frame) => parse(frame).id === `trpi_${before + 1}`,
		);
		await answerQueuedRequests(socket);
		await Promise.all(reads);
		expect(after).toBe(before + 1);
		expect(receiptIndex).toBeGreaterThanOrEqual(0);
		expect(replacementIndex).toBeGreaterThan(receiptIndex);
	});

	test("reconnect replays admitted IDs and keeps unsent requests behind the same window", async () => {
		const transport = new WsTransport({ url: "ws://localhost:24242/ws" });
		transport.connect();
		const first = testSocket();
		first.open();
		const reads = Array.from({ length: 600 }, () => transport.request("project.list", {}));
		const admitted = requestsIn(first.sent);
		first.close();
		const offline = transport.request("workspace.list", { projectId: "offline" });
		await tick(520);
		const replacement = testSocket(1);
		replacement.open();
		const replayed = requestsIn(replacement.sent);
		const reconciled = resumesIn(replacement.sent);
		await answerQueuedRequests(replacement);
		await Promise.all([...reads, offline]);
		expect(replayed).toEqual(admitted);
		expect(replayed.length).toBeLessThan(512);
		expect(reconciled[0]).toHaveLength(601);
		expect(new Set(requestsIn(replacement.sent).map((frame) => frame.id)).size).toBe(601);
	});

	test("a failed send retains one slot and retries that same ID after reconnect", async () => {
		const statuses: string[] = [];
		const transport = new WsTransport({
			url: "ws://localhost:24242/ws",
			onStatus: (status) => statuses.push(status),
		});
		transport.connect();
		const first = testSocket();
		first.open();
		first.send = () => {
			throw new Error("socket buffer closed");
		};
		const reads = Array.from({ length: 600 }, () => transport.request("project.list", {}));
		await tick(520);
		const replacement = testSocket(1);
		replacement.open();
		const initial = requestsIn(replacement.sent);
		await answerQueuedRequests(replacement);
		await Promise.all(reads);
		expect(initial[0]?.id).toBe("trpi_1");
		expect(initial.length).toBeLessThan(512);
		expect(new Set(requestsIn(replacement.sent).map((frame) => frame.id)).size).toBe(600);
		expect(statuses.at(-1)).toBe("connected");
	});
});
