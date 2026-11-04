import { type IceServer, parseIceServers } from "./iceServers";

const MAX_KEY = 512;
const MAX_DATA = 256 * 1024;

/**
 * A frame a client (host or device) sends to the signaling broker. `data` is opaque signaling. A host proves
 * it owns the key it registers (`register` → broker `challenge` → `prove`), so no one can take over its
 * address on a shared relay.
 */
export type ClientToBroker =
	| { t: "register"; hostKey: string }
	| { t: "prove"; signature: string }
	| { t: "connect"; hostKey: string }
	| { t: "frame"; data: string; session?: string }
	| { t: "close"; session?: string };

/** A frame the signaling broker sends to a client. */
export type BrokerToClient =
	| { t: "challenge"; nonce: string }
	| { t: "registered" }
	| { t: "open"; session: string }
	| { t: "ready"; ice?: IceServer[] }
	| { t: "frame"; data: string; session?: string }
	| { t: "close"; session?: string }
	| { t: "error"; reason: string };

function bounded(value: unknown, max: number): value is string {
	return typeof value === "string" && value.length > 0 && value.length <= max;
}

/** Validates an untrusted client→broker frame; returns null on any shape, type, or bound mismatch. */
export function parseClientMessage(raw: string): ClientToBroker | null {
	const message = parseObject(raw);
	if (!message) return null;
	switch (message.t) {
		case "register":
			return bounded(message.hostKey, MAX_KEY) ? { t: "register", hostKey: message.hostKey } : null;
		case "prove":
			return bounded(message.signature, MAX_KEY)
				? { t: "prove", signature: message.signature }
				: null;
		case "connect":
			return bounded(message.hostKey, MAX_KEY) ? { t: "connect", hostKey: message.hostKey } : null;
		case "frame":
			if (!bounded(message.data, MAX_DATA)) return null;
			return typeof message.session === "string"
				? { t: "frame", data: message.data, session: message.session }
				: { t: "frame", data: message.data };
		case "close":
			return typeof message.session === "string"
				? { t: "close", session: message.session }
				: { t: "close" };
		default:
			return null;
	}
}

/** Validates a broker→client frame; returns null on any shape, type, or bound mismatch. */
export function parseBrokerMessage(raw: string): BrokerToClient | null {
	const message = parseObject(raw);
	if (!message) return null;
	switch (message.t) {
		case "challenge":
			return bounded(message.nonce, MAX_KEY) ? { t: "challenge", nonce: message.nonce } : null;
		case "registered":
			return { t: "registered" };
		case "open":
			return bounded(message.session, MAX_KEY) ? { t: "open", session: message.session } : null;
		case "ready": {
			if (message.ice === undefined) return { t: "ready" };
			const ice = parseIceServers(message.ice);
			return ice ? { t: "ready", ice } : null;
		}
		case "frame":
			if (!bounded(message.data, MAX_DATA)) return null;
			return typeof message.session === "string"
				? { t: "frame", data: message.data, session: message.session }
				: { t: "frame", data: message.data };
		case "close":
			return typeof message.session === "string"
				? { t: "close", session: message.session }
				: { t: "close" };
		case "error":
			return bounded(message.reason, MAX_DATA) ? { t: "error", reason: message.reason } : null;
		default:
			return null;
	}
}

export function encodeBrokerFrame(message: ClientToBroker | BrokerToClient): string {
	return JSON.stringify(message);
}

function parseObject(raw: string): Record<string, unknown> | null {
	let value: unknown;
	try {
		value = JSON.parse(raw);
	} catch {
		return null;
	}
	return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}
