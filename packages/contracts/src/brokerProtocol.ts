const MAX_KEY = 512;
const MAX_DATA = 256 * 1024;

/** A frame a client (host or device) sends to the signaling broker. `data` is opaque signaling. */
export type ClientToBroker =
	| { t: "register"; hostKey: string }
	| { t: "connect"; hostKey: string }
	| { t: "frame"; data: string; session?: string }
	| { t: "close"; session?: string };

/** A frame the signaling broker sends to a client. */
export type BrokerToClient =
	| { t: "open"; session: string }
	| { t: "ready" }
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
		case "open":
			return bounded(message.session, MAX_KEY) ? { t: "open", session: message.session } : null;
		case "ready":
			return { t: "ready" };
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
