import { createPublicKey, randomBytes, randomUUID, verify } from "node:crypto";
import {
	type BrokerToClient,
	type ClientToBroker,
	type IceServer,
	parseClientMessage,
	registerTranscript,
} from "@thinkrail/contracts";

export interface BrokerSocket {
	send(message: BrokerToClient): void;
	close(): void;
}

export interface Broker {
	connect(connId: string, socket: BrokerSocket): void;
	receive(connId: string, raw: string): void;
	disconnect(connId: string): void;
	/** True while a connection has neither registered as a host nor connected as a device. */
	isPending(connId: string): boolean;
	readonly hostCount: number;
	readonly sessionCount: number;
}

type ConnState =
	| { role: "new" }
	| { role: "proving"; hostKey: string; nonce: string }
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

export interface BrokerDeps {
	newSessionId?: () => string;
	newNonce?: () => string;
	/** Checks a host's Ed25519 signature against the raw (base64url) public key it registers. */
	verifyHost?: (hostKey: string, data: Uint8Array, signature: string) => boolean;
	/** TURN credentials for a connecting device only; none when the relay runs no TURN. */
	iceFor?: () => IceServer[];
	maxSessionsPerHost?: number;
}

const DEFAULT_MAX_SESSIONS_PER_HOST = 64;

/** `publicKeyRaw` is a base64url raw Ed25519 key; a string `signature` is base64url. */
export function verifyEd25519(
	publicKeyRaw: string,
	data: Uint8Array,
	signature: string | Uint8Array,
): boolean {
	try {
		const key = createPublicKey({
			key: { kty: "OKP", crv: "Ed25519", x: publicKeyRaw },
			format: "jwk",
		});
		const sig = typeof signature === "string" ? Buffer.from(signature, "base64url") : signature;
		return verify(null, data, key, sig);
	} catch {
		return false;
	}
}

export function createBroker(deps: BrokerDeps = {}): Broker {
	const newSessionId = deps.newSessionId ?? randomUUID;
	const newNonce = deps.newNonce ?? (() => randomBytes(32).toString("base64url"));
	const verifyHost = deps.verifyHost ?? verifyEd25519;
	const maxSessionsPerHost = deps.maxSessionsPerHost ?? DEFAULT_MAX_SESSIONS_PER_HOST;
	const conns = new Map<string, Conn>();
	const hosts = new Map<string, string>();
	const sessions = new Map<string, Session>();
	const sessionsByHost = new Map<string, Set<string>>();

	const addSession = (sessionId: string, session: Session): void => {
		sessions.set(sessionId, session);
		let ids = sessionsByHost.get(session.hostId);
		if (!ids) {
			ids = new Set();
			sessionsByHost.set(session.hostId, ids);
		}
		ids.add(sessionId);
	};

	const removeSession = (sessionId: string): Session | undefined => {
		const session = sessions.get(sessionId);
		if (!session) return undefined;
		sessions.delete(sessionId);
		const ids = sessionsByHost.get(session.hostId);
		ids?.delete(sessionId);
		if (ids?.size === 0) sessionsByHost.delete(session.hostId);
		return session;
	};

	const dropHostSessions = (hostConnId: string): void => {
		const ids = sessionsByHost.get(hostConnId);
		if (!ids) return;
		sessionsByHost.delete(hostConnId);
		for (const sessionId of ids) {
			const session = sessions.get(sessionId);
			sessions.delete(sessionId);
			const device = session && conns.get(session.deviceId);
			if (device) {
				device.socket.send({ t: "close" });
				device.socket.close();
			}
		}
	};

	const fail = (conn: Conn, reason: string): void => {
		conn.socket.send({ t: "error", reason });
		conn.socket.close();
	};

	const handle = (conn: Conn, connId: string, message: ClientToBroker): void => {
		if (conn.state.role === "new") {
			if (message.t === "register") {
				const nonce = newNonce();
				conn.state = { role: "proving", hostKey: message.hostKey, nonce };
				conn.socket.send({ t: "challenge", nonce });
				return;
			}
			if (message.t === "connect") {
				const hostId = hosts.get(message.hostKey);
				if (hostId === undefined) {
					fail(conn, "no host available");
					return;
				}
				if ((sessionsByHost.get(hostId)?.size ?? 0) >= maxSessionsPerHost) {
					fail(conn, "host busy");
					return;
				}
				const session = newSessionId();
				const ice = deps.iceFor?.();
				addSession(session, { hostId, deviceId: connId });
				conn.state = { role: "device", session };
				conn.socket.send(ice ? { t: "ready", ice } : { t: "ready" });
				conns.get(hostId)?.socket.send({ t: "open", session });
				return;
			}
			fail(conn, "expected register or connect");
			return;
		}

		if (conn.state.role === "proving") {
			const { hostKey, nonce } = conn.state;
			if (
				message.t !== "prove" ||
				!verifyHost(hostKey, registerTranscript(nonce), message.signature)
			) {
				fail(conn, "host key proof rejected");
				return;
			}
			const existing = hosts.get(hostKey);
			if (existing !== undefined && existing !== connId) {
				conns.get(existing)?.socket.close();
				conns.delete(existing);
				dropHostSessions(existing);
			}
			hosts.set(hostKey, connId);
			conn.state = { role: "host", hostKey };
			conn.socket.send({ t: "registered" });
			return;
		}

		if (conn.state.role === "host") {
			if (message.t === "frame" && message.session !== undefined) {
				const session = sessions.get(message.session);
				if (session) conns.get(session.deviceId)?.socket.send({ t: "frame", data: message.data });
			} else if (message.t === "close" && message.session !== undefined) {
				const session = removeSession(message.session);
				if (session) {
					const device = conns.get(session.deviceId);
					if (device) {
						device.socket.send({ t: "close" });
						device.socket.close();
					}
				}
			}
			return;
		}

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
			const session = removeSession(sessionId);
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
				fail(conn, "malformed message");
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
				const session = removeSession(conn.state.session);
				if (session)
					conns.get(session.hostId)?.socket.send({ t: "close", session: conn.state.session });
			}
		},
		isPending(connId) {
			const role = conns.get(connId)?.state.role;
			return role === "new" || role === "proving";
		},
		get hostCount() {
			return hosts.size;
		},
		get sessionCount() {
			return sessions.size;
		},
	};
}
