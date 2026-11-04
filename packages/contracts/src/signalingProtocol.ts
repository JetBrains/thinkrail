const MAX_LABEL = 64;
const MAX_FIELD = 8192;

/**
 * Frames a device sends over the signaling channel (untrusted on the host — validated by `parseDeviceMessage`).
 * The relay carries them, so none is a bearer secret: `hello` names the QR token only by its hash
 * (`pairingTokenId`), the token itself proves itself as an HMAC in `proof`, and the answer is signed by the
 * device key so a relay cannot splice in its own WebRTC endpoint. See `pairingAuth.ts`.
 */
export type DeviceMessage =
	| { kind: "hello"; tokenId: string; devicePublicKey: string; label: string; nonce: string }
	| { kind: "resume"; devicePublicKey: string; nonce: string }
	| { kind: "proof"; signature: string; mac?: string }
	| { kind: "answer"; sdp: string; signature: string }
	| { kind: "candidate"; candidate: string }
	| { kind: "bye" };

/** Frames the host sends back over the signaling channel. The offer is signed by the host key. */
export type HostMessage =
	| { kind: "challenge"; challenge: string }
	| { kind: "accepted" }
	| { kind: "rejected"; reason: string }
	| { kind: "offer"; sdp: string; signature: string }
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
			return field(message.tokenId) &&
				field(message.devicePublicKey) &&
				field(message.nonce) &&
				trimmed
				? {
						kind: "hello",
						tokenId: message.tokenId,
						devicePublicKey: message.devicePublicKey,
						label: trimmed,
						nonce: message.nonce,
					}
				: null;
		}
		case "resume":
			return field(message.devicePublicKey) && field(message.nonce)
				? { kind: "resume", devicePublicKey: message.devicePublicKey, nonce: message.nonce }
				: null;
		case "proof":
			if (!field(message.signature)) return null;
			if (message.mac === undefined) return { kind: "proof", signature: message.signature };
			return field(message.mac)
				? { kind: "proof", signature: message.signature, mac: message.mac }
				: null;
		case "answer":
			return field(message.sdp) && field(message.signature)
				? { kind: "answer", sdp: message.sdp, signature: message.signature }
				: null;
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
			return field(message.sdp) && field(message.signature)
				? { kind: "offer", sdp: message.sdp, signature: message.signature }
				: null;
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
