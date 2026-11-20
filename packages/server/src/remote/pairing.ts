import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { PAIRING_CHALLENGE_BYTES, pairingMacInput, proofTranscript } from "@thinkrail/contracts";
import { verifySignature } from "./identity";

/** A fresh random challenge the host issues; the device must sign it to prove it holds its key. */
export function newChallenge(): string {
	return randomBytes(PAIRING_CHALLENGE_BYTES).toString("base64url");
}

/** The public name of a QR token — base64url(SHA-256(token)) — the only form of it the relay ever sees. */
export function pairingTokenId(token: string): string {
	return createHash("sha256").update(token, "utf8").digest("base64url");
}

export interface PairingProof {
	/** base64url raw Ed25519 device public key. */
	devicePublicKey: string;
	/** base64url challenge the host issued for this attempt. */
	challenge: string;
	/** base64url device signature over `proofTranscript(hostPublicKey, challenge)`. */
	signature: string;
}

/** Verifies a device's proof-of-key over this host's challenge to it. */
export function verifyPairingProof(hostPublicKey: string, proof: PairingProof): boolean {
	return verifySignature(
		proof.devicePublicKey,
		proofTranscript(hostPublicKey, proof.challenge),
		Buffer.from(proof.signature, "base64url"),
	);
}

/** The HMAC a first-pairing device sends to prove it read the QR token, bound to its key and this challenge. */
export function pairingMac(token: string, devicePublicKey: string, challenge: string): string {
	return createHmac("sha256", Buffer.from(token, "utf8"))
		.update(pairingMacInput(devicePublicKey, challenge))
		.digest("base64url");
}

export function verifyPairingMac(
	token: string,
	devicePublicKey: string,
	challenge: string,
	mac: string,
): boolean {
	const expected = Buffer.from(pairingMac(token, devicePublicKey, challenge), "base64url");
	const provided = Buffer.from(mac, "base64url");
	return provided.length === expected.length && timingSafeEqual(provided, expected);
}
