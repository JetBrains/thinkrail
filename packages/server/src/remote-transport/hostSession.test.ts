import { expect, test } from "bun:test";
import type { PairedDevice } from "../remote";
import type { RemoteChannel } from "./channel";
import type { HostPeer, HostPeerSignal } from "./hostPeer";
import { createHostSession } from "./hostSession";
import type { HostMessage } from "./signalingProtocol";
import { createHostHandshake } from "./signalingSession";

function fakePeer() {
	const calls = { start: 0, answers: [] as string[], candidates: [] as string[] };
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
		close: () => {},
	};
	return {
		peer,
		calls,
		emitSignal: (s: HostPeerSignal) => signal(s),
		emitChannel: (c: RemoteChannel) => channel(c),
	};
}

function handshake() {
	const registered: PairedDevice[] = [];
	const hs = createHostHandshake({
		newChallenge: () => "CHALLENGE",
		consumeToken: (token) => (token === "good" ? { projectRef: "proj", expiresAt: 1 } : null),
		verifyProof: (proof) => proof.signature === "valid",
		registerDevice: (d) => registered.push(d),
		now: () => 1,
		newDeviceId: () => "dev-1",
	});
	return { hs, registered };
}

const hello = { kind: "hello", token: "good", devicePublicKey: "KEY", label: "Phone" } as const;

test("does not start negotiation until the device is authorized", () => {
	const { peer, calls } = fakePeer();
	const sent: HostMessage[] = [];
	const session = createHostSession({ handshake: handshake().hs, peer, send: (m) => sent.push(m) });

	session.receive(hello);
	expect(sent).toEqual([{ kind: "challenge", challenge: "CHALLENGE" }]);
	expect(calls.start).toBe(0);

	session.receive({ kind: "proof", signature: "forged" });
	expect(sent.at(-1)?.kind).toBe("rejected");
	expect(calls.start).toBe(0);
});

test("after acceptance it starts the peer and forwards its local offer/candidates", () => {
	const { peer, calls, emitSignal } = fakePeer();
	const sent: HostMessage[] = [];
	const session = createHostSession({ handshake: handshake().hs, peer, send: (m) => sent.push(m) });

	session.receive(hello);
	session.receive({ kind: "proof", signature: "valid" });
	expect(sent.at(-1)).toEqual({ kind: "accepted" });
	expect(calls.start).toBe(1);

	emitSignal({ kind: "offer", sdp: "OFFER" });
	expect(sent.at(-1)).toEqual({ kind: "offer", sdp: "OFFER" });
	emitSignal({ kind: "candidate", candidate: "CAND" });
	expect(sent.at(-1)).toEqual({ kind: "candidate", candidate: "CAND" });
});

test("post-auth answer and candidates are routed into the peer", () => {
	const { peer, calls } = fakePeer();
	const session = createHostSession({ handshake: handshake().hs, peer, send: () => {} });
	session.receive(hello);
	session.receive({ kind: "proof", signature: "valid" });

	session.receive({ kind: "answer", sdp: "ANSWER" });
	session.receive({ kind: "candidate", candidate: "DCAND" });
	expect(calls.answers).toEqual(["ANSWER"]);
	expect(calls.candidates).toEqual(["DCAND"]);
});

test("the opened channel is handed out with the authorized device", () => {
	const { peer, emitChannel } = fakePeer();
	const session = createHostSession({ handshake: handshake().hs, peer, send: () => {} });
	const handed: PairedDevice[] = [];
	session.onChannel((_channel, device) => {
		handed.push(device);
	});
	session.receive(hello);
	session.receive({ kind: "proof", signature: "valid" });
	emitChannel({
		open: true,
		send: () => {},
		onMessage: () => {},
		onClose: () => {},
		close: () => {},
	});
	expect(handed.map((d) => d.id)).toEqual(["dev-1"]);
});
