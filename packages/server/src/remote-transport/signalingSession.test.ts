import { expect, test } from "bun:test";
import type { PairedDevice } from "../remote";
import { createHostHandshake, type HandshakeDeps } from "./signalingSession";

function deps(over: Partial<HandshakeDeps> = {}): {
	deps: HandshakeDeps;
	registered: PairedDevice[];
} {
	const registered: PairedDevice[] = [];
	return {
		registered,
		deps: {
			newChallenge: () => "CHALLENGE",
			consumeToken: (tokenId) =>
				tokenId === "good-id" ? { projectRef: "proj", expiresAt: 1, token: "SECRET" } : null,
			verifyProof: (proof) => proof.signature === "valid",
			verifyMac: (token, devicePublicKey, challenge, mac) =>
				mac === `${token}|${devicePublicKey}|${challenge}`,
			registerDevice: (device) => registered.push(device),
			findDevice: (key) =>
				key === "KNOWNKEY"
					? { id: "dev-known", label: "Known phone", publicKey: "KNOWNKEY", pairedAt: 1 }
					: null,
			now: () => 123,
			newDeviceId: () => "dev-xyz",
			...over,
		},
	};
}

const hello = {
	kind: "hello",
	tokenId: "good-id",
	devicePublicKey: "KEY",
	label: "Phone",
	nonce: "NONCE",
} as const;
const goodMac = "SECRET|KEY|CHALLENGE";

test("happy path: hello → challenge, valid proof → accepted + authorized + device registered", () => {
	const { deps: d, registered } = deps();
	const hs = createHostHandshake(d);

	expect(hs.handle(hello)).toEqual({ send: { kind: "challenge", challenge: "CHALLENGE" } });

	const step = hs.handle({ kind: "proof", signature: "valid", mac: goodMac });
	expect(step.send).toEqual({ kind: "accepted" });
	expect(step.done).toBe(true);
	expect(step.authorized).toEqual({
		device: { id: "dev-xyz", label: "Phone", publicKey: "KEY", pairedAt: 123 },
		projectRef: "proj",
		nonce: "NONCE",
		challenge: "CHALLENGE",
	});
	expect(registered).toHaveLength(1);
});

test("an invalid or expired token is rejected before any challenge", () => {
	const { deps: d, registered } = deps();
	const step = createHostHandshake(d).handle({ ...hello, tokenId: "bad-id" });
	expect(step.send).toMatchObject({ kind: "rejected", code: "invalid_code" });
	expect(step.done).toBe(true);
	expect(registered).toHaveLength(0);
});

test("a bad proof is rejected and registers nothing", () => {
	const { deps: d, registered } = deps();
	const hs = createHostHandshake(d);
	hs.handle(hello);
	const step = hs.handle({ kind: "proof", signature: "forged", mac: goodMac });
	expect(step.send?.kind).toBe("rejected");
	expect(step.done).toBe(true);
	expect(registered).toHaveLength(0);
});

test("a first pairing without the QR-token HMAC, or with a wrong one, is rejected", () => {
	for (const mac of [undefined, "SECRET|RELAYKEY|CHALLENGE"]) {
		const { deps: d, registered } = deps();
		const hs = createHostHandshake(d);
		hs.handle(hello);
		const proof =
			mac === undefined
				? ({ kind: "proof", signature: "valid" } as const)
				: ({ kind: "proof", signature: "valid", mac } as const);
		expect(hs.handle(proof).send?.kind).toBe("rejected");
		expect(registered).toHaveLength(0);
	}
});

test("resume re-authorizes a known device without a token, preserving its id", () => {
	const { deps: d, registered } = deps();
	const hs = createHostHandshake(d);

	expect(hs.handle({ kind: "resume", devicePublicKey: "KNOWNKEY", nonce: "N" })).toEqual({
		send: { kind: "challenge", challenge: "CHALLENGE" },
	});
	const step = hs.handle({ kind: "proof", signature: "valid" });
	expect(step.authorized?.device.id).toBe("dev-known");
	expect(step.authorized?.device.label).toBe("Known phone");
	expect(registered.at(-1)?.id).toBe("dev-known");
});

test("resume for an unknown device is rejected", () => {
	const { deps: d } = deps();
	const step = createHostHandshake(d).handle({
		kind: "resume",
		devicePublicKey: "STRANGER",
		nonce: "N",
	});
	expect(step.send).toMatchObject({ kind: "rejected", code: "unknown_device" });
	expect(step.done).toBe(true);
});

test("out-of-order frames are rejected, and frames after close are ignored", () => {
	const { deps: d } = deps();
	const hs = createHostHandshake(d);
	expect(hs.handle({ kind: "proof", signature: "valid" }).send?.kind).toBe("rejected");
	expect(hs.handle(hello)).toEqual({ done: true });
});
