const MAX_LABEL = 64;
const MAX_FIELD = 8192;

/** Frames a device sends over the signaling channel (untrusted on the host — validated by `parseDeviceMessage`). */
export type DeviceMessage =
	| { kind: "hello"; token: string; devicePublicKey: string; label: string }
	| { kind: "proof"; signature: string }
	| { kind: "offer"; sdp: string }
	| { kind: "answer"; sdp: string }
	| { kind: "candidate"; candidate: string }
	| { kind: "bye" };

/** Frames the host sends back over the signaling channel. */
export type HostMessage =
	| { kind: "challenge"; challenge: string }
	| { kind: "accepted" }
	| { kind: "rejected"; reason: string }
	| { kind: "offer"; sdp: string }
	| { kind: "answer"; sdp: string }
	| { kind: "candidate"; candidate: string }
	| { kind: "bye" };

function field(value: unknown): value is string {
	return typeof value === "string" && value.length > 0 && value.length <= MAX_FIELD;
}

function label(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const trimmed = value.trim().slice(0, MAX_LABEL);
	return trimmed.length > 0 ? trimmed : null;
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

/** Validates an untrusted device frame, returning null on any shape, type, or bound mismatch. */
export function parseDeviceMessage(raw: string): DeviceMessage | null {
	const message = parseObject(raw);
	if (!message) return null;
	switch (message.kind) {
		case "hello": {
			const trimmed = label(message.label);
			return field(message.token) && field(message.devicePublicKey) && trimmed
				? {
						kind: "hello",
						token: message.token,
						devicePublicKey: message.devicePublicKey,
						label: trimmed,
					}
				: null;
		}
		case "proof":
			return field(message.signature) ? { kind: "proof", signature: message.signature } : null;
		case "offer":
			return field(message.sdp) ? { kind: "offer", sdp: message.sdp } : null;
		case "answer":
			return field(message.sdp) ? { kind: "answer", sdp: message.sdp } : null;
		case "candidate":
			return field(message.candidate) ? { kind: "candidate", candidate: message.candidate } : null;
		case "bye":
			return { kind: "bye" };
		default:
			return null;
	}
}

/** Validates a host frame on the device side. */
export function parseHostMessage(raw: string): HostMessage | null {
	const message = parseObject(raw);
	if (!message) return null;
	switch (message.kind) {
		case "challenge":
			return field(message.challenge) ? { kind: "challenge", challenge: message.challenge } : null;
		case "accepted":
			return { kind: "accepted" };
		case "rejected":
			return field(message.reason) ? { kind: "rejected", reason: message.reason } : null;
		case "offer":
			return field(message.sdp) ? { kind: "offer", sdp: message.sdp } : null;
		case "answer":
			return field(message.sdp) ? { kind: "answer", sdp: message.sdp } : null;
		case "candidate":
			return field(message.candidate) ? { kind: "candidate", candidate: message.candidate } : null;
		case "bye":
			return { kind: "bye" };
		default:
			return null;
	}
}

export function encodeHostMessage(message: HostMessage): string {
	return JSON.stringify(message);
}

export function encodeDeviceMessage(message: DeviceMessage): string {
	return JSON.stringify(message);
}
