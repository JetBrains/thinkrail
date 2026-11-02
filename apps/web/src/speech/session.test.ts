import { expect, test } from "bun:test";
import { type Capture, CaptureFailure, type CaptureSink } from "./captureTypes";
import { createDictationController, type SpeechSocketLike } from "./session";

class FakeSocket implements SpeechSocketLike {
	readyState = 0;
	binaryType: BinaryType = "blob";
	onopen: ((event: Event) => void) | null = null;
	onmessage: ((event: MessageEvent) => void) | null = null;
	onclose: ((event: CloseEvent) => void) | null = null;
	onerror: ((event: Event) => void) | null = null;
	sent: (string | ArrayBuffer)[] = [];
	closed = false;
	send(data: string | ArrayBuffer) {
		this.sent.push(data);
	}
	close() {
		this.closed = true;
		this.readyState = 3;
	}
	open() {
		this.readyState = 1;
		this.onopen?.(new Event("open"));
	}
	server(message: object) {
		this.onmessage?.(new MessageEvent("message", { data: JSON.stringify(message) }));
	}
	controls() {
		return this.sent
			.filter((data): data is string => typeof data === "string")
			.map((d) => JSON.parse(d));
	}
}

function harness(capture: (sink: CaptureSink) => Promise<Capture> = async () => ({ stop() {} })) {
	const sockets: FakeSocket[] = [];
	const controller = createDictationController({
		openSocket: () => {
			const socket = new FakeSocket();
			sockets.push(socket);
			return socket;
		},
		startCapture: capture,
	});
	const field = { value: "Refactor", caret: 8 };
	const target = (ownerId = "composer") => ({
		ownerId,
		anchor: () => ({ base: field.value, start: field.caret, end: field.caret }),
		write: (text: string, caret: number) => {
			field.value = text;
			field.caret = caret;
		},
		scope: { workspaceId: "w1", sessionId: "s1" },
	});
	return { controller, sockets, field, target };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

test("a dictation writes partials and finals into the field and keeps them on stop", async () => {
	const { controller, sockets, field, target } = harness();
	controller.start(target());
	expect(controller.snapshot()).toMatchObject({ ownerId: "composer", phase: "connecting" });
	const socket = sockets[0];
	if (!socket) throw new Error("no socket");
	socket.open();
	expect(socket.controls()[0]).toEqual({ type: "start", workspaceId: "w1", sessionId: "s1" });
	socket.server({ type: "ready" });
	expect(controller.snapshot().phase).toBe("listening");
	socket.server({ type: "partial", text: "the sto" });
	expect(field.value).toBe("Refactor the sto");
	socket.server({ type: "final", text: "the store." });
	socket.server({ type: "partial", text: "Then test" });
	expect(field).toEqual({ value: "Refactor the store. Then test", caret: 29 });
	controller.stop("composer");
	expect(controller.snapshot().phase).toBe("stopping");
	expect(socket.controls().at(-1)).toEqual({ type: "stop" });
	socket.server({ type: "final", text: "Then test it." });
	socket.server({ type: "ended" });
	expect(field.value).toBe("Refactor the store. Then test it.");
	expect(controller.snapshot()).toEqual({ ownerId: null, phase: "idle", level: 0, error: null });
	expect(socket.closed).toBe(true);
});

test("audio captured before the socket opens is sent after the start", async () => {
	let sink: CaptureSink | null = null;
	const { controller, sockets, target } = harness(async (s) => {
		sink = s;
		return { stop() {} };
	});
	controller.start(target());
	await tick();
	const frame = new ArrayBuffer(640);
	(sink as CaptureSink | null)?.frame(frame);
	const socket = sockets[0];
	socket?.open();
	expect(socket?.sent[0]).toBeTypeOf("string");
	expect(socket?.sent[1]).toBe(frame);
});

test("starting a second field ends the first one and keeps its text", async () => {
	const { controller, sockets, field, target } = harness();
	controller.start(target("composer"));
	sockets[0]?.open();
	sockets[0]?.server({ type: "partial", text: "half a thought" });
	controller.start(target("review"));
	expect(sockets[0]?.closed).toBe(true);
	expect(field.value).toBe("Refactor half a thought");
	expect(controller.snapshot().ownerId).toBe("review");
});

test("a denied microphone ends the dictation with its reason", async () => {
	const { controller, sockets, target } = harness(async () => {
		throw new CaptureFailure("denied");
	});
	controller.start(target());
	await tick();
	expect(controller.snapshot()).toMatchObject({
		phase: "idle",
		error: { ownerId: "composer", code: "denied" },
	});
	expect(sockets[0]?.closed).toBe(true);
});

test("a host error ends the dictation with its code", () => {
	const { controller, sockets, target } = harness();
	controller.start(target());
	sockets[0]?.open();
	sockets[0]?.server({ type: "error", code: "SPEECH_NOT_INSTALLED" });
	expect(controller.snapshot().error).toEqual({
		ownerId: "composer",
		code: "SPEECH_NOT_INSTALLED",
	});
});

test("a lost socket while listening is an engine failure", () => {
	const { controller, sockets, target } = harness();
	controller.start(target());
	sockets[0]?.open();
	sockets[0]?.onclose?.(new CloseEvent("close"));
	expect(controller.snapshot().error?.code).toBe("SPEECH_ENGINE_FAILED");
});

test("stopping another field's dictation is a no-op", () => {
	const { controller, sockets, target } = harness();
	controller.start(target("composer"));
	sockets[0]?.open();
	controller.stop("review");
	expect(controller.snapshot().phase).toBe("connecting");
});

test("a stop before a cold engine is ready waits for it instead of timing out", () => {
	const timers: (() => void)[] = [];
	const realSetTimeout = globalThis.setTimeout;
	globalThis.setTimeout = ((fn: () => void) => {
		timers.push(fn);
		return 0;
	}) as unknown as typeof setTimeout;
	try {
		const { controller, sockets, field, target } = harness();
		controller.start(target());
		const socket = sockets[0];
		socket?.open();
		controller.stop();
		expect(timers).toHaveLength(0);
		socket?.server({ type: "ready" });
		expect(timers).toHaveLength(1);
		socket?.server({ type: "final", text: "cold start works" });
		socket?.server({ type: "ended" });
		expect(field.value).toBe("Refactor cold start works");
		expect(controller.snapshot().error).toBeNull();
	} finally {
		globalThis.setTimeout = realSetTimeout;
	}
});
