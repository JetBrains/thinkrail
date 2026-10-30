import { randomUUID } from "node:crypto";
import { type BrokerToClient, type ClientToBroker, parseClientMessage } from "@thinkrail/contracts";

/**
 * The zero-knowledge signaling broker. It pairs a device to the host it names (by the host's public key) and
 * relays opaque signaling frames between them, multiplexed per session so one host serves many devices. It
 * never parses `data`: the WebRTC DataChannel it helps set up is end-to-end encrypted, and the pairing
 * challenge/proof it relays are host-enforced, so the broker learns neither session content nor secrets.
 */
export interface BrokerSocket {
	send(message: BrokerToClient): void;
	close(): void;
}

export interface Broker {
	connect(connId: string, socket: BrokerSocket): void;
	receive(connId: string, raw: string): void;
	disconnect(connId: string): void;
	readonly hostCount: number;
	readonly sessionCount: number;
}

type ConnState =
	| { role: "new" }
	| { role: "host"; hostKey: string }
	| { role: "device"; session: string };

interface Conn {
	socket: BrokerSocket;
	state: ConnState;
}

interface Session {
	hostId: string;
	deviceId: string;
}

export function createBroker(deps: { newSessionId?: () => string } = {}): Broker {
	const newSessionId = deps.newSessionId ?? randomUUID;
	const conns = new Map<string, Conn>();
	const hosts = new Map<string, string>();
	const sessions = new Map<string, Session>();

	const dropHostSessions = (hostConnId: string): void => {
		for (const [sessionId, session] of [...sessions]) {
			if (session.hostId === hostConnId) {
				sessions.delete(sessionId);
				const device = conns.get(session.deviceId);
				if (device) {
					device.socket.send({ t: "close" });
					device.socket.close();
				}
			}
		}
	};

	const handle = (conn: Conn, connId: string, message: ClientToBroker): void => {
		if (conn.state.role === "new") {
			if (message.t === "register") {
				const existing = hosts.get(message.hostKey);
				if (existing !== undefined && existing !== connId) {
					conns.get(existing)?.socket.close();
					conns.delete(existing);
					dropHostSessions(existing);
				}
				hosts.set(message.hostKey, connId);
				conn.state = { role: "host", hostKey: message.hostKey };
				return;
			}
			if (message.t === "connect") {
				const hostId = hosts.get(message.hostKey);
				if (hostId === undefined) {
					conn.socket.send({ t: "error", reason: "no host available" });
					conn.socket.close();
					return;
				}
				const session = newSessionId();
				sessions.set(session, { hostId, deviceId: connId });
				conn.state = { role: "device", session };
				conn.socket.send({ t: "ready" });
				conns.get(hostId)?.socket.send({ t: "open", session });
				return;
			}
			conn.socket.send({ t: "error", reason: "expected register or connect" });
			conn.socket.close();
			return;
		}

		if (conn.state.role === "host") {
			if (message.t === "frame" && message.session !== undefined) {
				const session = sessions.get(message.session);
				if (session) conns.get(session.deviceId)?.socket.send({ t: "frame", data: message.data });
			} else if (message.t === "close" && message.session !== undefined) {
				const session = sessions.get(message.session);
				if (session) {
					sessions.delete(message.session);
					const device = conns.get(session.deviceId);
					if (device) {
						device.socket.send({ t: "close" });
						device.socket.close();
					}
				}
			}
			return;
		}

		// device
		const sessionId = conn.state.session;
		if (message.t === "frame") {
			const session = sessions.get(sessionId);
			if (session) {
				conns
					.get(session.hostId)
					?.socket.send({ t: "frame", session: sessionId, data: message.data });
			}
			return;
		}
		if (message.t === "close") {
			const session = sessions.get(sessionId);
			sessions.delete(sessionId);
			if (session) conns.get(session.hostId)?.socket.send({ t: "close", session: sessionId });
			conns.delete(connId);
			conn.socket.close();
		}
	};

	return {
		connect(connId, socket) {
			conns.set(connId, { socket, state: { role: "new" } });
		},
		receive(connId, raw) {
			const conn = conns.get(connId);
			if (!conn) return;
			const message = parseClientMessage(raw);
			if (!message) {
				conn.socket.send({ t: "error", reason: "malformed message" });
				conn.socket.close();
				return;
			}
			handle(conn, connId, message);
		},
		disconnect(connId) {
			const conn = conns.get(connId);
			if (!conn) return;
			conns.delete(connId);
			if (conn.state.role === "host") {
				hosts.delete(conn.state.hostKey);
				dropHostSessions(connId);
			} else if (conn.state.role === "device") {
				const session = sessions.get(conn.state.session);
				sessions.delete(conn.state.session);
				if (session)
					conns.get(session.hostId)?.socket.send({ t: "close", session: conn.state.session });
			}
		},
		get hostCount() {
			return hosts.size;
		},
		get sessionCount() {
			return sessions.size;
		},
	};
}
