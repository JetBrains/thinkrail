import { expect, test } from "bun:test";
import { answerTranscript, offerTranscript } from "@thinkrail/contracts";
import type { PairedDevice } from "../remote";
import type { RemoteChannel } from "./channel";
import type { HostPeer, HostPeerSignal } from "./hostPeer";
import { createHostSession, type HostSessionDeps } from "./hostSession";
import type { HostMessage } from "./signalingProtocol";
import { createHostHandshake } from "./signalingSession";

function fakePeer() {
	const calls = { start: 0, closed: 0, answers: [] as string[], candidates: [] as string[] };
	let signal: (s: HostPeerSignal) => void = () => {};
	let channel: (c: RemoteChannel) => void = () => {};
	const peer: HostPeer = {
		start: async () => void calls.start++,
		acceptAnswer: async (sdp) => void calls.answers.push(sdp),
		addCandidate: async (c) => void calls.candidates.push(c),
		onLocalSignal: (h) => {
			signal = h;
		},
		onChannel: (h) => {
			channel = h;
		},
		close: () => void calls.closed++,
	};
	return {
		peer,
		calls,
		emitSignal: (s: HostPeerSignal) => signal(s),
		emitChannel: (c: RemoteChannel) => channel(c),
	};
}

const text = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);

/** A transparent stand-in for Ed25519: a "signature" is the transcript text tagged with the signer. */
const fakeCrypto: Pick<HostSessionDeps, "sign" | "verify"> = {
	sign: (data) => new TextEncoder().encode(`host:${text(data)}`),
	verify: (key, data, signature) => text(signature) === `${key}:${text(data)}`,
};
const deviceSignature = (key: string, data: Uint8Array): string =>
	Buffer.from(`${key}:${text(data)}`).toString("base64url");

function handshake() {
	const registered: PairedDevice[] = [];
	const hs = createHostHandshake({
		newChallenge: () => "CHALLENGE",
		consumeToken: (id) =>
			id === "good-id" ? { projectRef: "proj", expiresAt: 1, token: "T" } : null,
		verifyProof: (proof) => proof.signature === "valid",
		verifyMac: (_token, _key, _challenge, mac) => mac === "mac",
		registerDevice: (d) => registered.push(d),
		findDevice: () => null,
		now: () => 1,
		newDeviceId: () => "dev-1",
	});
	return { hs, registered };
}

const hello = {
	kind: "hello",
	tokenId: "good-id",
	devicePublicKey: "KEY",
	label: "Phone",
	nonce: "NONCE",
} as const;
const proof = { kind: "proof", signature: "valid", mac: "mac" } as const;

function session(peer: HostPeer, sent: HostMessage[] = []) {
	return createHostSession({
		handshake: handshake().hs,
		peer,
		send: (m) => sent.push(m),
		...fakeCrypto,
	});
}

test("does not start negotiation until the device is authorized", () => {
	const { peer, calls } = fakePeer();
	const sent: HostMessage[] = [];
	const s = session(peer, sent);

	s.receive(hello);
	expect(sent).toEqual([{ kind: "challenge", challenge: "CHALLENGE" }]);
	expect(calls.start).toBe(0);

	s.receive({ kind: "proof", signature: "forged", mac: "mac" });
	expect(sent.at(-1)?.kind).toBe("rejected");
	expect(calls.start).toBe(0);
});

test("after acceptance it starts the peer and sends a host-signed offer bound to nonce and challenge", () => {
	const { peer, calls, emitSignal } = fakePeer();
	const sent: HostMessage[] = [];
	const s = session(peer, sent);

	s.receive(hello);
	s.receive(proof);
	expect(sent.at(-1)).toEqual({ kind: "accepted" });
	expect(calls.start).toBe(1);

	emitSignal({ kind: "offer", sdp: "OFFER" });
	const offer = sent.at(-1);
	expect(offer?.kind).toBe("offer");
	if (offer?.kind !== "offer") throw new Error("expected an offer");
	expect(offer.sdp).toBe("OFFER");
	expect(Buffer.from(offer.signature, "base64url").toString()).toBe(
		`host:${text(offerTranscript("NONCE", "CHALLENGE", "OFFER"))}`,
	);
	emitSignal({ kind: "candidate", candidate: "CAND" });
	expect(sent.at(-1)).toEqual({ kind: "candidate", candidate: "CAND" });
});

test("a device-signed answer and candidates are routed into the peer", () => {
	const { peer, calls } = fakePeer();
	const s = session(peer);
	s.receive(hello);
	s.receive(proof);

	const signature = deviceSignature("KEY", answerTranscript("CHALLENGE", "ANSWER"));
	s.receive({ kind: "answer", sdp: "ANSWER", signature });
	s.receive({ kind: "candidate", candidate: "DCAND" });
	expect(calls.answers).toEqual(["ANSWER"]);
	expect(calls.candidates).toEqual(["DCAND"]);
});

test("an answer not signed by the paired device key is rejected and closes the session", () => {
	const { peer, calls } = fakePeer();
	const sent: HostMessage[] = [];
	const s = session(peer, sent);
	s.receive(hello);
	s.receive(proof);

	const spliced = deviceSignature("RELAYKEY", answerTranscript("CHALLENGE", "RELAY-ANSWER"));
	s.receive({ kind: "answer", sdp: "RELAY-ANSWER", signature: spliced });
	expect(calls.answers).toEqual([]);
	expect(calls.closed).toBe(1);
	expect(sent.at(-1)?.kind).toBe("rejected");
	s.receive({ kind: "candidate", candidate: "late" });
	expect(calls.candidates).toEqual([]);
});

test("the opened channel is handed out with the authorized device", () => {
	const { peer, emitChannel } = fakePeer();
	const s = session(peer);
	const handed: PairedDevice[] = [];
	s.onChannel((_channel, device) => {
		handed.push(device);
	});
	s.receive(hello);
	s.receive(proof);
	emitChannel({
		open: true,
		send: () => {},
		onMessage: () => {},
		onClose: () => {},
		close: () => {},
	});
	expect(handed.map((d) => d.id)).toEqual(["dev-1"]);
});
