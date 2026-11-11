import { afterEach, beforeEach, expect, jest, test } from "bun:test";
import {
	type BrokerToClient,
	buildPairingUri,
	encodeBrokerFrame,
	encodeHostMessage,
	type HostMessage,
	offerTranscript,
	parseClientMessage,
	parseDeviceMessage,
} from "@thinkrail/contracts";
import { RemoteConnectError } from "./connectError";
import {
	CONNECT_TIMEOUT_MS,
	type ConnectionEvents,
	connectRemoteProject,
	connectSavedHost,
} from "./deviceConnector";
import { BROKER_READY_TIMEOUT_MS } from "./signalingRoute";

type Listener = (event: unknown) => void;

class Emitter {
	private readonly listeners = new Map<string, Set<Listener>>();
	addEventListener(type: string, listener: Listener): void {
		const set = this.listeners.get(type) ?? new Set();
		set.add(listener);
		this.listeners.set(type, set);
	}
	removeEventListener(type: string, listener: Listener): void {
		this.listeners.get(type)?.delete(listener);
	}
	emit(type: string, event: unknown = {}): void {
		for (const listener of [...(this.listeners.get(type) ?? [])]) listener(event);
	}
}

type HostMode = "silent" | "ready" | "handshake";
let hostMode: HostMode = "handshake";
let hostPrivateKey: CryptoKey;
let hostKey = "";
const sockets: FakeSocket[] = [];
const peers: FakePeer[] = [];

const b64url = (bytes: ArrayBuffer): string =>
	btoa(String.fromCharCode(...new Uint8Array(bytes)))
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/, "");

class FakeSocket extends Emitter {
	closed = false;
	private nonce = "";
	readonly url: string;
	constructor(url: string) {
		super();
		this.url = url;
		sockets.push(this);
		queueMicrotask(() => this.emit("open"));
	}
	private reply(frame: BrokerToClient): void {
		queueMicrotask(() => {
			if (!this.closed) this.emit("message", { data: encodeBrokerFrame(frame) });
		});
	}
	proofs = 0;
	host(message: HostMessage): void {
		this.reply({ t: "frame", data: encodeHostMessage(message) });
	}
	send(raw: string): void {
		const frame = parseClientMessage(raw);
		if (frame?.t === "connect" && hostMode !== "silent") this.reply({ t: "ready" });
		if (frame?.t !== "frame" || hostMode !== "handshake") return;
		const message = parseDeviceMessage(frame.data);
		if (message?.kind === "resume" || message?.kind === "hello") {
			this.nonce = message.nonce;
			this.host({ kind: "challenge", challenge: "Y2hhbGxlbmdl" });
		} else if (message?.kind === "proof") {
			this.proofs += 1;
			void crypto.subtle
				.sign(
					{ name: "Ed25519" },
					hostPrivateKey,
					offerTranscript(this.nonce, "Y2hhbGxlbmdl", "offer-sdp"),
				)
				.then((signature) =>
					this.host({ kind: "offer", sdp: "offer-sdp", signature: b64url(signature) }),
				);
		}
	}
	close(): void {
		if (this.closed) return;
		this.closed = true;
		queueMicrotask(() => this.emit("close"));
	}
}

class FakeChannel extends Emitter {
	readyState = "connecting";
	binaryType = "blob";
	send(): void {}
	close(): void {
		if (this.readyState === "closed") return;
		this.readyState = "closed";
		this.emit("close");
	}
	open(): void {
		this.readyState = "open";
		this.emit("open");
	}
}

class FakePeer extends Emitter {
	closed = false;
	answered = false;
	connectionState = "new";
	constructor() {
		super();
		peers.push(this);
	}
	async setRemoteDescription(): Promise<void> {}
	async createAnswer(): Promise<{ type: "answer"; sdp: string }> {
		return { type: "answer", sdp: "answer-sdp" };
	}
	async setLocalDescription(): Promise<void> {
		this.answered = true;
	}
	async addIceCandidate(): Promise<void> {}
	close(): void {
		this.closed = true;
	}
	openChannel(): FakeChannel {
		this.connectionState = "connected";
		const channel = new FakeChannel();
		this.emit("datachannel", { channel });
		channel.open();
		return channel;
	}
}

const saved = {
	WebSocket: globalThis.WebSocket,
	RTCPeerConnection: (globalThis as { RTCPeerConnection?: unknown }).RTCPeerConnection,
	localStorage: (globalThis as { localStorage?: unknown }).localStorage,
};

beforeEach(async () => {
	sockets.length = 0;
	peers.length = 0;
	hostMode = "handshake";
	const pair = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, [
		"sign",
		"verify",
	])) as CryptoKeyPair;
	hostPrivateKey = pair.privateKey;
	hostKey = b64url(await crypto.subtle.exportKey("raw", pair.publicKey));
	const store = new Map<string, string>();
	Object.assign(globalThis, {
		WebSocket: FakeSocket,
		RTCPeerConnection: FakePeer,
		localStorage: {
			getItem: (key: string) => store.get(key) ?? null,
			setItem: (key: string, value: string) => void store.set(key, value),
		},
	});
	jest.useFakeTimers();
});

afterEach(() => {
	jest.useRealTimers();
	Object.assign(globalThis, saved);
});

/** Lets crypto and socket microtasks run while the clock stays still. */
const settle = async (until?: () => boolean): Promise<void> => {
	const ticks = until ? 20_000 : 200;
	for (let i = 0; i < ticks && !until?.(); i += 1)
		await new Promise<void>((resolve) => setImmediate(resolve));
};

const connect = (events: ConnectionEvents = {}) =>
	connectSavedHost({ relayUrl: "ws://host:1", hostKey, label: "phone" }, events);

/** A saved-host connection with what it reported: open changes, retried failures, a loss. */
function watched() {
	const opens: boolean[] = [];
	const misses: unknown[] = [];
	const lost: RemoteConnectError[] = [];
	const connection = connect({
		onOpenChange: (open) => opens.push(open),
		onRetryFailed: (error) => misses.push(error),
		onLost: (error) => lost.push(error),
	});
	return { connection, opens, misses, lost };
}

const codeOf = (error: unknown): string | undefined =>
	error instanceof RemoteConnectError ? error.code : undefined;

test("a saved host returns at once and its loop makes the first attempt", async () => {
	const { connection, opens } = watched();
	await settle(() => peers[0]?.answered === true);
	expect(opens).toEqual([]);
	peers[0]?.openChannel();
	await settle(() => opens.length > 0);
	expect(opens).toEqual([true]);
	connection.close();
});

test("a relay that opens but never gets ready fails the attempt as relay_lost, socket closed, and is retried", async () => {
	hostMode = "silent";
	const { connection, misses } = watched();
	await settle(() => sockets.length > 0);
	await settle();
	jest.advanceTimersByTime(BROKER_READY_TIMEOUT_MS);
	await settle(() => misses.length > 0);
	expect(misses.map(codeOf)).toEqual(["relay_lost"]);
	expect(sockets.every((socket) => socket.closed)).toBe(true);
	jest.advanceTimersByTime(500);
	await settle(() => sockets.length > 1);
	expect(sockets).toHaveLength(2);
	connection.close();
});

test("a host that never answers fails as host_silent with its peer and socket closed", async () => {
	hostMode = "ready";
	const { connection, misses } = watched();
	await settle(() => peers.length > 0);
	jest.advanceTimersByTime(CONNECT_TIMEOUT_MS);
	await settle(() => misses.length > 0);
	expect(misses.map(codeOf)).toEqual(["host_silent"]);
	expect(peers[0]?.closed).toBe(true);
	expect(sockets[0]?.closed).toBe(true);
	connection.close();
});

test("a channel opening after its attempt timed out is closed, not attached", async () => {
	const { connection, misses } = watched();
	await settle(() => peers[0]?.answered === true);
	jest.advanceTimersByTime(CONNECT_TIMEOUT_MS);
	await settle(() => misses.length > 0);
	expect(misses.map(codeOf)).toEqual(["no_direct_route"]);
	const late = peers[0]?.openChannel();
	expect(late?.readyState).toBe("closed");
	connection.close();
});

test("a pairing whose first attempt fails rejects and is not retried", async () => {
	hostMode = "ready";
	const link = buildPairingUri({
		signalingUrls: ["ws://host:1"],
		token: "token",
		hostPublicKey: hostKey,
		projectRef: "default",
	});
	const outcome = connectRemoteProject(link, { label: "phone" }).then(
		() => null,
		(error: unknown) => error,
	);
	await settle(() => peers.length > 0);
	jest.advanceTimersByTime(CONNECT_TIMEOUT_MS);
	expect(codeOf(await outcome)).toBe("host_silent");
	jest.advanceTimersByTime(60_000);
	await settle();
	expect(peers).toHaveLength(1);
});

test("a refusal no retry fixes ends a saved host's loop through onLost", async () => {
	const { connection, lost, misses } = watched();
	await settle(() => sockets[0]?.proofs === 1);
	sockets[0]?.host({ kind: "rejected", reason: "unknown device", code: "unknown_device" });
	await settle(() => lost.length > 0);
	expect(lost.map(codeOf)).toEqual(["unknown_device"]);
	expect(misses).toEqual([]);
	jest.advanceTimersByTime(60_000);
	await settle();
	expect(sockets).toHaveLength(1);
	connection.close();
});

async function live() {
	const watch = watched();
	await settle(() => peers[0]?.answered === true);
	const channel = peers[0]?.openChannel();
	await settle(() => watch.opens.length > 0);
	watch.opens.length = 0;
	return { ...watch, channel };
}

test("close() during a reconnect attempt ends it at once and nothing fires after", async () => {
	const { connection, channel, opens, misses } = await live();
	channel?.close();
	expect(opens).toEqual([false]);
	expect(peers[0]?.closed).toBe(true);
	jest.advanceTimersByTime(500);
	await settle(() => peers[1]?.answered === true);
	expect(peers).toHaveLength(2);

	connection.close();
	expect(peers[1]?.closed).toBe(true);
	expect(sockets[1]?.closed).toBe(true);
	peers[1]?.openChannel();
	jest.advanceTimersByTime(CONNECT_TIMEOUT_MS * 2);
	await settle();
	expect(opens).toEqual([false]);
	expect(misses).toEqual([]);
	expect(peers).toHaveLength(2);
});

test("reconnectNow during an in-flight attempt does not start a second one", async () => {
	const { connection, channel, opens } = await live();
	channel?.close();
	connection.reconnectNow();
	await settle(() => peers[1]?.answered === true);
	connection.reconnectNow();
	connection.reconnectNow();
	await settle();
	expect(peers).toHaveLength(2);
	peers[1]?.openChannel();
	await settle(() => opens.length > 1);
	expect(opens).toEqual([false, true]);
	connection.close();
});

test("host frames after the channel opened never tear the live connection down", async () => {
	const { connection, opens } = await live();
	sockets[0]?.host({ kind: "challenge", challenge: "c2Vjb25k" });
	sockets[0]?.host({ kind: "rejected", reason: "denied", code: "denied" });
	await settle();
	expect(opens).toEqual([]);
	expect(sockets[0]?.proofs).toBe(1);
	expect(peers[0]?.closed).toBe(false);
	connection.close();
});

test("a second challenge mid-handshake is not answered again", async () => {
	const { connection } = watched();
	await settle(() => sockets[0]?.proofs === 1);
	sockets[0]?.host({ kind: "challenge", challenge: "c2Vjb25k" });
	await settle(() => peers[0]?.answered === true);
	await settle();
	expect(sockets[0]?.proofs).toBe(1);
	connection.close();
});

test("losing the signaling route after the channel opened keeps the connection", async () => {
	const { connection, opens } = await live();
	sockets[0]?.close();
	await settle();
	expect(opens).toEqual([]);
	expect(peers[0]?.closed).toBe(false);
	connection.close();
});

test("reconnectNow on a connection that looks open but is dead drops it and retries at once", async () => {
	const { connection, channel, opens } = await live();
	if (channel) channel.readyState = "closed";
	connection.reconnectNow();
	expect(opens).toEqual([false]);
	expect(peers[0]?.closed).toBe(true);
	await settle(() => peers[1]?.answered === true);
	expect(peers).toHaveLength(2);
	peers[1]?.openChannel();
	await settle(() => opens.length > 1);
	expect(opens).toEqual([false, true]);

	const peer = peers[1];
	if (peer) peer.connectionState = "disconnected";
	connection.reconnectNow();
	expect(opens).toEqual([false, true, false]);
	connection.close();
});

test("reconnectNow on a healthy connection changes nothing", async () => {
	const { connection, opens } = await live();
	connection.reconnectNow();
	await settle();
	expect(opens).toEqual([]);
	expect(peers).toHaveLength(1);
	connection.close();
});
