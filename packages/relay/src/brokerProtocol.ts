const MAX_KEY = 512;
const MAX_DATA = 256 * 1024;

/** A frame a client (host or device) sends to the broker. `data` is opaque signaling — never parsed here. */
export type ClientToBroker =
	| { t: "register"; hostKey: string }
	| { t: "connect"; hostKey: string }
	| { t: "frame"; data: string; session?: string }
	| { t: "close"; session?: string };

/** A frame the broker sends to a client. */
export type BrokerToClient =
	| { t: "open"; session: string }
	| { t: "ready" }
	| { t: "frame"; data: string; session?: string }
	| { t: "close"; session?: string }
	| { t: "error"; reason: string };

function bounded(value: unknown, max: number): value is string {
	return typeof value === "string" && value.length > 0 && value.length <= max;
}

/** Validates an untrusted client frame; returns null on any shape, type, or bound mismatch. */
export function parseClientMessage(raw: string): ClientToBroker | null {
	let value: unknown;
	try {
		value = JSON.parse(raw);
	} catch {
		return null;
	}
	if (typeof value !== "object" || value === null) return null;
	const message = value as Record<string, unknown>;
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

export function encode(message: ClientToBroker | BrokerToClient): string {
	return JSON.stringify(message);
}
