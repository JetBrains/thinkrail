import { encodeBrokerFrame, parseBrokerMessage } from "@thinkrail/contracts";
import type { HostSession } from "./hostSession";
import { encodeHostMessage, type HostMessage, parseDeviceMessage } from "./signalingProtocol";

export interface BrokerClientSocket {
	send(raw: string): void;
	close(): void;
}

export interface HostBrokerDeps {
	/** The host's public key; the broker addresses devices to it. */
	hostKey: string;
	socket: BrokerClientSocket;
	/**
	 * Builds a fully-wired session for a brokered device. `toDevice` sends host signaling back through the
	 * broker for this session; the caller wires the handshake, WebRTC peer, and channel handoff.
	 */
	openSession: (sessionId: string, toDevice: (message: HostMessage) => void) => HostSession;
}

export interface HostBrokerClient {
	/** Registers the host with the broker. */
	start(): void;
	/** Handles one raw broker→client frame. */
	receive(raw: string): void;
	stop(): void;
	readonly sessionCount: number;
}

/**
 * The host's outbound broker client: registers by public key, then maps each brokered device session to a
 * `HostSession`, relaying signaling payloads in (device→host) and out (host→device). It speaks the shared
 * broker protocol from `contracts` rather than importing the relay service.
 */
export function createHostBrokerClient(deps: HostBrokerDeps): HostBrokerClient {
	const sessions = new Map<string, HostSession>();
	const send = (frame: Parameters<typeof encodeBrokerFrame>[0]): void =>
		deps.socket.send(encodeBrokerFrame(frame));

	return {
		start() {
			send({ t: "register", hostKey: deps.hostKey });
		},
		receive(raw) {
			const message = parseBrokerMessage(raw);
			if (!message) return;
			if (message.t === "open") {
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
		stop() {
			for (const session of sessions.values()) session.close();
			sessions.clear();
			deps.socket.close();
		},
		get sessionCount() {
			return sessions.size;
		},
	};
}

/** Thin wrapper driving the broker client over a real WebSocket to the relay. */
export function connectHostBroker(
	url: string,
	deps: Omit<HostBrokerDeps, "socket">,
): HostBrokerClient {
	const ws = new WebSocket(url);
	const client = createHostBrokerClient({
		...deps,
		socket: { send: (raw) => ws.send(raw), close: () => ws.close() },
	});
	ws.addEventListener("open", () => client.start());
	ws.addEventListener("message", (event) => {
		if (typeof event.data === "string") client.receive(event.data);
	});
	return client;
}
