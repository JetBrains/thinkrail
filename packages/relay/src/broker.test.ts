import { expect, test } from "bun:test";
import { generateKeyPairSync, sign } from "node:crypto";
import { type BrokerToClient, registerTranscript } from "@thinkrail/contracts";
import {
	type Broker,
	type BrokerDeps,
	type BrokerSocket,
	createBroker,
	verifyEd25519,
} from "./broker";

interface Spy extends BrokerSocket {
	readonly sent: BrokerToClient[];
	readonly closed: boolean;
}

function spy(): Spy {
	const sent: BrokerToClient[] = [];
	let closed = false;
	return {
		sent,
		get closed() {
			return closed;
		},
		send: (message) => void sent.push(message),
		close: () => {
			closed = true;
		},
	};
}

/** A stand-in for Ed25519: a host "signs" a nonce by echoing it with its key. */
const fakeVerify: NonNullable<BrokerDeps["verifyHost"]> = (key, data, signature) =>
	signature === `${key}:${new TextDecoder().decode(data)}`;

function newBroker(over: BrokerDeps = {}): Broker {
	let n = 0;
	return createBroker({
		newSessionId: () => `S${++n}`,
		newNonce: () => "NONCE",
		verifyHost: fakeVerify,
		...over,
	});
}

function register(broker: Broker, connId: string, hostKey: string): void {
	broker.receive(connId, JSON.stringify({ t: "register", hostKey }));
	const signature = `${hostKey}:${new TextDecoder().decode(registerTranscript("NONCE"))}`;
	broker.receive(connId, JSON.stringify({ t: "prove", signature }));
}

function fixture(over: BrokerDeps = {}): { broker: Broker; host: Spy; device: Spy } {
	const broker = newBroker(over);
	const host = spy();
	const device = spy();
	broker.connect("host", host);
	broker.connect("device", device);
	return { broker, host, device };
}

test("a device connecting with no registered host gets an error and is closed", () => {
	const { broker, device } = fixture();
	broker.receive("device", JSON.stringify({ t: "connect", hostKey: "K" }));
	expect(device.sent).toEqual([{ t: "error", reason: "no host available" }]);
	expect(device.closed).toBe(true);
});

test("register then connect opens a session and relays frames both ways", () => {
	const { broker, host, device } = fixture();
	register(broker, "host", "K");
	broker.receive("device", JSON.stringify({ t: "connect", hostKey: "K" }));

	expect(device.sent).toEqual([{ t: "ready" }]);
	expect(host.sent).toEqual([
		{ t: "challenge", nonce: "NONCE" },
		{ t: "registered" },
		{ t: "open", session: "S1" },
	]);
	expect(broker.hostCount).toBe(1);
	expect(broker.sessionCount).toBe(1);

	broker.receive("device", JSON.stringify({ t: "frame", data: "offer-sdp" }));
	expect(host.sent.at(-1)).toEqual({ t: "frame", session: "S1", data: "offer-sdp" });

	broker.receive("host", JSON.stringify({ t: "frame", session: "S1", data: "answer-sdp" }));
	expect(device.sent.at(-1)).toEqual({ t: "frame", data: "answer-sdp" });
});

test("a device disconnect closes its session and notifies the host", () => {
	const { broker, host } = fixture();
	register(broker, "host", "K");
	broker.receive("device", JSON.stringify({ t: "connect", hostKey: "K" }));
	broker.disconnect("device");
	expect(host.sent.at(-1)).toEqual({ t: "close", session: "S1" });
	expect(broker.sessionCount).toBe(0);
});

test("a host disconnect closes the device", () => {
	const { broker, device } = fixture();
	register(broker, "host", "K");
	broker.receive("device", JSON.stringify({ t: "connect", hostKey: "K" }));
	broker.disconnect("host");
	expect(device.sent.at(-1)).toEqual({ t: "close" });
	expect(device.closed).toBe(true);
	expect(broker.hostCount).toBe(0);
});

test("a malformed frame is rejected and the connection closed", () => {
	const { broker, device } = fixture();
	broker.receive("device", "not json");
	expect(device.sent).toEqual([{ t: "error", reason: "malformed message" }]);
	expect(device.closed).toBe(true);
});

test("one host serves two concurrent device sessions independently", () => {
	const broker = newBroker();
	const host = spy();
	const d1 = spy();
	const d2 = spy();
	broker.connect("host", host);
	broker.connect("d1", d1);
	broker.connect("d2", d2);
	register(broker, "host", "K");
	broker.receive("d1", JSON.stringify({ t: "connect", hostKey: "K" }));
	broker.receive("d2", JSON.stringify({ t: "connect", hostKey: "K" }));
	expect(broker.sessionCount).toBe(2);

	broker.receive("host", JSON.stringify({ t: "frame", session: "S2", data: "for-d2" }));
	expect(d2.sent.at(-1)).toEqual({ t: "frame", data: "for-d2" });
	expect(d1.sent.at(-1)).toEqual({ t: "ready" });
});

test("a host that cannot prove its key is not registered and cannot take over a registered one", () => {
	const broker = newBroker();
	const real = spy();
	const impostor = spy();
	broker.connect("real", real);
	broker.connect("impostor", impostor);
	register(broker, "real", "K");

	broker.receive("impostor", JSON.stringify({ t: "register", hostKey: "K" }));
	expect(broker.isPending("impostor")).toBe(true);
	broker.receive("impostor", JSON.stringify({ t: "prove", signature: "forged" }));
	expect(impostor.sent.at(-1)).toEqual({ t: "error", reason: "host key proof rejected" });
	expect(impostor.closed).toBe(true);
	expect(real.closed).toBe(false);
	expect(broker.hostCount).toBe(1);
});

test("a host that re-registers with a valid proof replaces its previous connection", () => {
	const broker = newBroker();
	const first = spy();
	const second = spy();
	broker.connect("first", first);
	broker.connect("second", second);
	register(broker, "first", "K");
	register(broker, "second", "K");
	expect(first.closed).toBe(true);
	expect(second.sent.at(-1)).toEqual({ t: "registered" });
	expect(broker.hostCount).toBe(1);
});

test("the relay's TURN credentials go to the connecting device only", () => {
	const ice = [{ urls: ["turn:turn.example:3478"], username: "u", credential: "c" }];
	const { broker, host, device } = fixture({ iceFor: () => ice });
	register(broker, "host", "K");
	broker.receive("device", JSON.stringify({ t: "connect", hostKey: "K" }));
	expect(device.sent).toEqual([{ t: "ready", ice }]);
	expect(host.sent.at(-1)).toEqual({ t: "open", session: "S1" });
});

test("a host at its session cap turns further devices away", () => {
	const { broker, device } = fixture({ maxSessionsPerHost: 1 });
	const second = spy();
	broker.connect("second", second);
	register(broker, "host", "K");
	broker.receive("device", JSON.stringify({ t: "connect", hostKey: "K" }));
	broker.receive("second", JSON.stringify({ t: "connect", hostKey: "K" }));
	expect(device.sent).toEqual([{ t: "ready" }]);
	expect(second.sent).toEqual([{ t: "error", reason: "host busy" }]);
	expect(broker.sessionCount).toBe(1);
});

test("verifyEd25519 checks a real host signature over the register transcript", () => {
	const { publicKey, privateKey } = generateKeyPairSync("ed25519");
	const hostKey = (publicKey.export({ format: "jwk" }) as { x: string }).x;
	const data = registerTranscript("N");
	const signature = sign(null, data, privateKey).toString("base64url");
	expect(verifyEd25519(hostKey, data, signature)).toBe(true);
	expect(verifyEd25519(hostKey, registerTranscript("other"), signature)).toBe(false);
	expect(verifyEd25519("not-a-key", data, signature)).toBe(false);
});
