import { expect, test } from "bun:test";
import { type Broker, type BrokerSocket, createBroker } from "./broker";
import type { BrokerToClient } from "./brokerProtocol";

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

function fixture(): { broker: Broker; host: Spy; device: Spy } {
	let n = 0;
	const broker = createBroker({ newSessionId: () => `S${++n}` });
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
	broker.receive("host", JSON.stringify({ t: "register", hostKey: "K" }));
	broker.receive("device", JSON.stringify({ t: "connect", hostKey: "K" }));

	expect(device.sent).toEqual([{ t: "ready" }]);
	expect(host.sent).toEqual([{ t: "open", session: "S1" }]);
	expect(broker.hostCount).toBe(1);
	expect(broker.sessionCount).toBe(1);

	broker.receive("device", JSON.stringify({ t: "frame", data: "offer-sdp" }));
	expect(host.sent.at(-1)).toEqual({ t: "frame", session: "S1", data: "offer-sdp" });

	broker.receive("host", JSON.stringify({ t: "frame", session: "S1", data: "answer-sdp" }));
	expect(device.sent.at(-1)).toEqual({ t: "frame", data: "answer-sdp" });
});

test("a device disconnect closes its session and notifies the host", () => {
	const { broker, host } = fixture();
	broker.receive("host", JSON.stringify({ t: "register", hostKey: "K" }));
	broker.receive("device", JSON.stringify({ t: "connect", hostKey: "K" }));
	broker.disconnect("device");
	expect(host.sent.at(-1)).toEqual({ t: "close", session: "S1" });
	expect(broker.sessionCount).toBe(0);
});

test("a host disconnect closes the device", () => {
	const { broker, device } = fixture();
	broker.receive("host", JSON.stringify({ t: "register", hostKey: "K" }));
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
	let n = 0;
	const broker = createBroker({ newSessionId: () => `S${++n}` });
	const host = spy();
	const d1 = spy();
	const d2 = spy();
	broker.connect("host", host);
	broker.connect("d1", d1);
	broker.connect("d2", d2);
	broker.receive("host", JSON.stringify({ t: "register", hostKey: "K" }));
	broker.receive("d1", JSON.stringify({ t: "connect", hostKey: "K" }));
	broker.receive("d2", JSON.stringify({ t: "connect", hostKey: "K" }));
	expect(broker.sessionCount).toBe(2);

	broker.receive("host", JSON.stringify({ t: "frame", session: "S2", data: "for-d2" }));
	expect(d2.sent.at(-1)).toEqual({ t: "frame", data: "for-d2" });
	expect(d1.sent.at(-1)).toEqual({ t: "ready" });
});
