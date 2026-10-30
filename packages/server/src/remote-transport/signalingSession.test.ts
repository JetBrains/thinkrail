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
			consumeToken: (token) => (token === "good" ? { projectRef: "proj", expiresAt: 1 } : null),
			verifyProof: (proof) => proof.signature === "valid",
			registerDevice: (device) => registered.push(device),
			now: () => 123,
			newDeviceId: () => "dev-xyz",
			...over,
		},
	};
}

const hello = { kind: "hello", token: "good", devicePublicKey: "KEY", label: "Phone" } as const;

test("happy path: hello → challenge, valid proof → accepted + authorized + device registered", () => {
	const { deps: d, registered } = deps();
	const hs = createHostHandshake(d);

	expect(hs.handle(hello)).toEqual({ send: { kind: "challenge", challenge: "CHALLENGE" } });

	const step = hs.handle({ kind: "proof", signature: "valid" });
	expect(step.send).toEqual({ kind: "accepted" });
	expect(step.done).toBe(true);
	expect(step.authorized).toEqual({
		device: { id: "dev-xyz", label: "Phone", publicKey: "KEY", pairedAt: 123 },
		projectRef: "proj",
	});
	expect(registered).toHaveLength(1);
});

test("an invalid or expired token is rejected before any challenge", () => {
	const { deps: d, registered } = deps();
	const step = createHostHandshake(d).handle({ ...hello, token: "bad" });
	expect(step.send?.kind).toBe("rejected");
	expect(step.done).toBe(true);
	expect(registered).toHaveLength(0);
});

test("a bad proof is rejected and registers nothing", () => {
	const { deps: d, registered } = deps();
	const hs = createHostHandshake(d);
	hs.handle(hello);
	const step = hs.handle({ kind: "proof", signature: "forged" });
	expect(step.send?.kind).toBe("rejected");
	expect(step.done).toBe(true);
	expect(registered).toHaveLength(0);
});

test("out-of-order frames are rejected, and frames after close are ignored", () => {
	const { deps: d } = deps();
	const hs = createHostHandshake(d);
	expect(hs.handle({ kind: "proof", signature: "valid" }).send?.kind).toBe("rejected");
	expect(hs.handle(hello)).toEqual({ done: true });
});
