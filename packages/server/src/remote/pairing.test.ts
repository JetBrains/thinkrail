import { expect, test } from "bun:test";
import { sign as edSign, generateKeyPairSync, type KeyObject } from "node:crypto";
import { newChallenge, verifyPairingProof } from "./pairing";

function deviceKey(): { publicKey: string; privateKey: KeyObject } {
	const { publicKey, privateKey } = generateKeyPairSync("ed25519");
	return { publicKey: (publicKey.export({ format: "jwk" }) as { x: string }).x, privateKey };
}

function signChallenge(privateKey: KeyObject, challenge: string): string {
	return edSign(null, Buffer.from(challenge, "base64url"), privateKey).toString("base64url");
}

test("verifyPairingProof accepts a valid device signature", () => {
	const { publicKey, privateKey } = deviceKey();
	const challenge = newChallenge();
	expect(
		verifyPairingProof({
			devicePublicKey: publicKey,
			challenge,
			signature: signChallenge(privateKey, challenge),
		}),
	).toBe(true);
});

test("verifyPairingProof rejects a replayed challenge, a wrong key, and garbage", () => {
	const { publicKey, privateKey } = deviceKey();
	const challenge = newChallenge();
	const signature = signChallenge(privateKey, challenge);
	expect(
		verifyPairingProof({ devicePublicKey: publicKey, challenge: newChallenge(), signature }),
	).toBe(false);
	expect(verifyPairingProof({ devicePublicKey: deviceKey().publicKey, challenge, signature })).toBe(
		false,
	);
	expect(verifyPairingProof({ devicePublicKey: publicKey, challenge, signature: "!!!" })).toBe(
		false,
	);
});

test("newChallenge is unique", () => {
	expect(newChallenge()).not.toBe(newChallenge());
});
