import { randomBytes } from "node:crypto";
import { verifySignature } from "./identity";

/** A fresh random challenge the host issues; the device must sign it to prove it holds its key. */
export function newChallenge(): string {
	return randomBytes(32).toString("base64url");
}

export interface PairingProof {
	/** base64url raw Ed25519 device public key. */
	devicePublicKey: string;
	/** base64url challenge the host issued for this attempt. */
	challenge: string;
	/** base64url device signature over the challenge bytes. */
	signature: string;
}

/**
 * Verifies a device's proof-of-key over the host-issued challenge. Transport-agnostic: the challenge and
 * signature travel over whatever channel the signaling layer provides (Ф4).
 */
export function verifyPairingProof(proof: PairingProof): boolean {
	return verifySignature(
		proof.devicePublicKey,
		Buffer.from(proof.challenge, "base64url"),
		Buffer.from(proof.signature, "base64url"),
	);
}
