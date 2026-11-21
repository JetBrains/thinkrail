import { expect, test } from "bun:test";
import { sign as edSign, generateKeyPairSync, type KeyObject } from "node:crypto";
import { answerTranscript, isPairingChallenge, proofTranscript } from "@thinkrail/contracts";
import { newChallenge, pairingMac, verifyPairingMac, verifyPairingProof } from "./pairing";

function deviceKey(): { publicKey: string; privateKey: KeyObject } {
	const { publicKey, privateKey } = generateKeyPairSync("ed25519");
	return { publicKey: (publicKey.export({ format: "jwk" }) as { x: string }).x, privateKey };
}

const HOST = deviceKey().publicKey;

function signed(privateKey: KeyObject, data: Uint8Array): string {
	return edSign(null, data, privateKey).toString("base64url");
}

test("verifyPairingProof accepts a device signature over the proof transcript for this host", () => {
	const { publicKey, privateKey } = deviceKey();
	const challenge = newChallenge();
	expect(
		verifyPairingProof(HOST, {
			devicePublicKey: publicKey,
			challenge,
			signature: signed(privateKey, proofTranscript(HOST, challenge)),
		}),
	).toBe(true);
});

test("verifyPairingProof rejects a replayed challenge, another host, a wrong key, and garbage", () => {
	const { publicKey, privateKey } = deviceKey();
	const challenge = newChallenge();
	const signature = signed(privateKey, proofTranscript(HOST, challenge));
	const proof = { devicePublicKey: publicKey, challenge, signature };
	expect(verifyPairingProof(HOST, { ...proof, challenge: newChallenge() })).toBe(false);
	expect(verifyPairingProof(deviceKey().publicKey, proof)).toBe(false);
	expect(verifyPairingProof(HOST, { ...proof, devicePublicKey: deviceKey().publicKey })).toBe(
		false,
	);
	expect(verifyPairingProof(HOST, { ...proof, signature: "!!!" })).toBe(false);
});

test("a signature over the raw challenge or another transcript never passes as a proof", () => {
	const { publicKey, privateKey } = deviceKey();
	const challenge = newChallenge();
	for (const data of [
		new Uint8Array(Buffer.from(challenge, "base64url")),
		answerTranscript(challenge, "v=0"),
	]) {
		expect(
			verifyPairingProof(HOST, {
				devicePublicKey: publicKey,
				challenge,
				signature: signed(privateKey, data),
			}),
		).toBe(false);
	}
});

test("newChallenge is unique and has the shape a device accepts", () => {
	expect(newChallenge()).not.toBe(newChallenge());
	expect(isPairingChallenge(newChallenge())).toBe(true);
});

test("verifyPairingMac binds the QR token to the device key and the challenge", () => {
	const challenge = newChallenge();
	const mac = pairingMac("token", "device-key", challenge);
	expect(verifyPairingMac("token", "device-key", challenge, mac)).toBe(true);
	expect(verifyPairingMac("other-token", "device-key", challenge, mac)).toBe(false);
	expect(verifyPairingMac("token", "relay-key", challenge, mac)).toBe(false);
	expect(verifyPairingMac("token", "device-key", newChallenge(), mac)).toBe(false);
	expect(verifyPairingMac("token", "device-key", challenge, "short")).toBe(false);
});
