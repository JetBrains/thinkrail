import { expect, test } from "bun:test";
import type { HostMessage } from "@thinkrail/contracts";
import { answerTranscript, offerTranscript } from "@thinkrail/contracts";
import type { PairedDevice } from "../remote";
import type { RemoteChannel } from "./channel";
import type { HostPeer, HostPeerSignal } from "./hostPeer";
import { createHostSession, type HostSessionDeps, OUTDATED_APP_REASON } from "./hostSession";
import { createHostHandshake } from "./signalingSession";

function fakePeer(fail: { start?: boolean; answer?: boolean; candidate?: boolean } = {}) {
	const calls = { start: 0, closed: 0, answers: [] as string[], candidates: [] as string[] };
	let signal: (s: HostPeerSignal) => void = () => {};
	let channel: (c: RemoteChannel) => void = () => {};
	const failure = async (): Promise<void> => {
		throw new Error("werift failed");
	};
	const peer: HostPeer = {
		start: fail.start ? failure : async () => void calls.start++,
		acceptAnswer: fail.answer ? failure : async (sdp) => void calls.answers.push(sdp),
		addCandidate: fail.candidate ? failure : async (c) => void calls.candidates.push(c),
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

function session(peer: HostPeer, sent: HostMessage[] = [], signalingWindowMs?: number) {
	return createHostSession({
		handshake: handshake().hs,
		peer,
		send: (m) => sent.push(m),
		...fakeCrypto,
		...(signalingWindowMs === undefined ? {} : { signalingWindowMs }),
	});
}

const channelStub: RemoteChannel = {
	open: true,
	send: () => {},
	onMessage: () => {},
	onClose: () => {},
	close: () => {},
};

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
	expect(calls.closed).toBe(1);
});

test("a terminal step closes the session once and tells its owner", () => {
	const { peer, calls } = fakePeer();
	const s = session(peer);
	let ended = 0;
	s.onClose(() => void ended++);
	s.receive({ kind: "proof", signature: "valid" });
	s.close();
	expect(calls.closed).toBe(1);
	expect(ended).toBe(1);
});

test("a session whose channel never opens is closed at its signaling deadline", async () => {
	const { peer, calls } = fakePeer();
	const s = session(peer, [], 20);
	const ended = new Promise<void>((resolve) => s.onClose(resolve));
	s.receive(hello);
	await ended;
	expect(calls.closed).toBe(1);
});

test("an opened channel outlives the signaling deadline", async () => {
	const { peer, calls, emitChannel } = fakePeer();
	const s = session(peer, [], 20);
	s.receive(hello);
	s.receive(proof);
	emitChannel(channelStub);
	await Bun.sleep(40);
	expect(s.opened).toBe(true);
	expect(calls.closed).toBe(0);
});

test("a peer that fails to start rejects the device and closes instead of escaping as a rejection", async () => {
	const { peer, calls } = fakePeer({ start: true });
	const sent: HostMessage[] = [];
	const s = session(peer, sent);
	const ended = new Promise<void>((resolve) => s.onClose(resolve));
	s.receive(hello);
	s.receive(proof);
	await ended;
	expect(sent.at(-1)).toMatchObject({ kind: "rejected", code: "denied" });
	expect(calls.closed).toBe(1);
});

test("an answer the peer cannot apply closes the session; a refused candidate does not", async () => {
	const candidate = fakePeer({ candidate: true });
	const kept = session(candidate.peer);
	kept.receive(hello);
	kept.receive(proof);
	kept.receive({ kind: "candidate", candidate: "bad" });
	await Bun.sleep(0);
	expect(candidate.calls.closed).toBe(0);

	const answer = fakePeer({ answer: true });
	const sent: HostMessage[] = [];
	const s = session(answer.peer, sent);
	const ended = new Promise<void>((resolve) => s.onClose(resolve));
	s.receive(hello);
	s.receive(proof);
	const signature = deviceSignature("KEY", answerTranscript("CHALLENGE", "ANSWER"));
	s.receive({ kind: "answer", sdp: "ANSWER", signature });
	await ended;
	expect(sent.at(-1)?.kind).toBe("rejected");
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

test("an unreadable frame tells an older app to update and ends the session", () => {
	const { peer, calls } = fakePeer();
	const sent: HostMessage[] = [];
	const s = session(peer, sent);
	s.receiveUnreadable();
	expect(sent).toEqual([{ kind: "rejected", reason: OUTDATED_APP_REASON, code: "outdated_app" }]);
	expect(calls.closed).toBe(1);
	s.receive(hello);
	expect(sent).toHaveLength(1);
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
	emitChannel(channelStub);
	expect(handed.map((d) => d.id)).toEqual(["dev-1"]);
});
