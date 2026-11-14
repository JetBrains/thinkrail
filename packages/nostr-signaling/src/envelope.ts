/** The ephemeral event kind (NIP-01 range 20000–29999: relays forward it and never store it). */
export const SIGNALING_KIND = 25051;

const MAX_SEQ = 10_000;
export const MAX_DATA = 64 * 1024;

/** The plaintext inside one NIP-44 encrypted event: a per-recipient sequence number and the signaling frame. */
export interface Envelope {
	seq: number;
	data: string;
}

export function encodeEnvelope(envelope: Envelope): string {
	return JSON.stringify({ s: envelope.seq, d: envelope.data });
}

/** Validates an untrusted decrypted envelope; null on any shape or bound mismatch. */
export function parseEnvelope(raw: string): Envelope | null {
	let value: unknown;
	try {
		value = JSON.parse(raw);
	} catch {
		return null;
	}
	if (typeof value !== "object" || value === null) return null;
	const { s, d } = value as { s?: unknown; d?: unknown };
	if (typeof s !== "number" || !Number.isInteger(s) || s < 0 || s >= MAX_SEQ) return null;
	if (typeof d !== "string" || d.length === 0 || d.length > MAX_DATA) return null;
	return { seq: s, data: d };
}

const MAX_BUFFERED = 64;

/**
 * Delivers one sender's frames in the order it sent them. Events reach a subscriber over several relays, so a
 * later frame (an ICE candidate) can land before an earlier one (the answer) it depends on.
 */
export function createInOrder(deliver: (data: string) => void): (envelope: Envelope) => void {
	let next = 0;
	const pending = new Map<number, string>();
	return (envelope) => {
		if (envelope.seq < next || pending.has(envelope.seq)) return;
		if (envelope.seq !== next) {
			if (pending.size < MAX_BUFFERED) pending.set(envelope.seq, envelope.data);
			return;
		}
		deliver(envelope.data);
		next += 1;
		for (let data = pending.get(next); data !== undefined; data = pending.get(next)) {
			pending.delete(next);
			deliver(data);
			next += 1;
		}
	};
}
