import {
	type ClientToBroker,
	encodeBrokerFrame,
	parseBrokerMessage,
	registerTranscript,
} from "@thinkrail/contracts";
import type { HostSession } from "./hostSession";
import { encodeHostMessage, type HostMessage, parseDeviceMessage } from "./signalingProtocol";

export interface BrokerClientSocket {
	send(raw: string): void;
	close(): void;
}

export interface HostBrokerDeps {
	/** The host's public key; the broker addresses devices to it. */
	hostKey: string;
	/** Signs with the host identity key, to prove ownership of `hostKey` when registering. */
	sign: (data: Uint8Array) => Uint8Array;
	/**
	 * Builds a fully-wired session for a brokered device. `toDevice` sends host signaling back through the
	 * broker for this session; the caller wires the handshake, WebRTC peer, and channel handoff.
	 */
	openSession: (sessionId: string, toDevice: (message: HostMessage) => void) => HostSession;
}

export interface HostBrokerClient {
	/** Points the client at a (fresh) broker connection and registers the host on it. */
	attach(socket: BrokerClientSocket): void;
	/** Handles one raw broker→client frame. */
	receive(raw: string): void;
	/** The broker connection dropped: every session it brokered is gone with it. */
	detach(): void;
	stop(): void;
	/** True once the broker accepted the host's proof of key on the current connection. */
	readonly registered: boolean;
	readonly sessionCount: number;
}

/**
 * The host's outbound broker client: registers by public key (answering the broker's challenge with a
 * signature), then maps each brokered device session to a `HostSession`, relaying signaling payloads in
 * (device→host) and out (host→device). It speaks the shared broker protocol from `contracts` rather than
 * importing the relay service.
 */
export function createHostBrokerClient(deps: HostBrokerDeps): HostBrokerClient {
	const sessions = new Map<string, HostSession>();
	let socket: BrokerClientSocket | null = null;
	let registered = false;
	const send = (frame: ClientToBroker): void => socket?.send(encodeBrokerFrame(frame));
	const closeSessions = (): void => {
		for (const session of sessions.values()) session.close();
		sessions.clear();
	};

	return {
		attach(next) {
			closeSessions();
			socket = next;
			registered = false;
			send({ t: "register", hostKey: deps.hostKey });
		},
		receive(raw) {
			const message = parseBrokerMessage(raw);
			if (!message) return;
			if (message.t === "challenge") {
				const signature = deps.sign(registerTranscript(message.nonce));
				send({ t: "prove", signature: Buffer.from(signature).toString("base64url") });
			} else if (message.t === "registered") {
				registered = true;
			} else if (message.t === "open") {
				if (sessions.has(message.session)) return;
				const sessionId = message.session;
				const toDevice = (hostMessage: HostMessage): void =>
					send({ t: "frame", session: sessionId, data: encodeHostMessage(hostMessage) });
				sessions.set(sessionId, deps.openSession(sessionId, toDevice));
			} else if (message.t === "frame" && message.session !== undefined) {
				const session = sessions.get(message.session);
				const device = parseDeviceMessage(message.data);
				if (session && device) session.receive(device);
			} else if (message.t === "close" && message.session !== undefined) {
				sessions.get(message.session)?.close();
				sessions.delete(message.session);
			}
		},
		detach() {
			closeSessions();
			socket = null;
			registered = false;
		},
		stop() {
			closeSessions();
			socket?.close();
			socket = null;
			registered = false;
		},
		get registered() {
			return registered;
		},
		get sessionCount() {
			return sessions.size;
		},
	};
}

export interface BrokerConnection {
	stop(): void;
}

const MIN_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 30_000;

/**
 * Drives the broker client over a real WebSocket to the relay and keeps it there: when the relay restarts or
 * the network drops, it reconnects with capped exponential backoff and registers again.
 */
export function connectHostBroker(url: string, deps: HostBrokerDeps): BrokerConnection {
	const client = createHostBrokerClient(deps);
	let stopped = false;
	let backoff = MIN_BACKOFF_MS;
	let timer: ReturnType<typeof setTimeout> | null = null;
	let ws: WebSocket | null = null;

	const open = (): void => {
		const socket = new WebSocket(url);
		ws = socket;
		socket.addEventListener("open", () => {
			backoff = MIN_BACKOFF_MS;
			client.attach({ send: (raw) => socket.send(raw), close: () => socket.close() });
		});
		socket.addEventListener("message", (event) => {
			if (typeof event.data === "string") client.receive(event.data);
		});
		socket.addEventListener("close", () => {
			if (ws !== socket) return;
			ws = null;
			client.detach();
			if (stopped) return;
			timer = setTimeout(open, backoff);
			backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
		});
	};
	open();

	return {
		stop() {
			stopped = true;
			if (timer) clearTimeout(timer);
			client.stop();
			ws?.close();
			ws = null;
		},
	};
}
