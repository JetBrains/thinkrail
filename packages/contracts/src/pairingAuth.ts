/**
 * The byte strings each remote party signs or MACs, shared so host and device build them identically. Each is
 * domain-separated (`thinkrail/<purpose>/v1`) so a signature for one purpose never verifies as another. The QR
 * token is named on the wire only by `pairingTokenId` = base64url(SHA-256(token)); the crypto itself stays
 * per platform (`node:crypto` on the host, `crypto.subtle` on the device).
 */
const encoder = new TextEncoder();

function transcript(purpose: string, ...parts: readonly string[]): Uint8Array<ArrayBuffer> {
	const bytes = encoder.encode([`thinkrail/${purpose}/v1`, ...parts].join("\n"));
	const out = new Uint8Array(new ArrayBuffer(bytes.length));
	out.set(bytes);
	return out;
}

/** What a host signs to prove to the relay that it owns the key it registers. */
export function registerTranscript(nonce: string): Uint8Array<ArrayBuffer> {
	return transcript("register", nonce);
}

/** What the host signs over its WebRTC offer, bound to the device's fresh nonce and the host's challenge. */
export function offerTranscript(
	nonce: string,
	challenge: string,
	sdp: string,
): Uint8Array<ArrayBuffer> {
	return transcript("offer", nonce, challenge, sdp);
}

/** What the device signs over its WebRTC answer, bound to the host's challenge. */
export function answerTranscript(challenge: string, sdp: string): Uint8Array<ArrayBuffer> {
	return transcript("answer", challenge, sdp);
}

/** The HMAC input that proves a first-pairing device read the QR token without sending the token itself. */
export function pairingMacInput(
	devicePublicKey: string,
	challenge: string,
): Uint8Array<ArrayBuffer> {
	return transcript("pair", devicePublicKey, challenge);
}
