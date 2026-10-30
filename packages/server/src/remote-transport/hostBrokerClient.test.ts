import { expect, test } from "bun:test";
import { type ClientToBroker, parseClientMessage } from "@thinkrail/contracts";
import { createHostBrokerClient } from "./hostBrokerClient";
import type { HostSession } from "./hostSession";
import type { DeviceMessage, HostMessage } from "./signalingProtocol";

function fixture() {
	const outbound: ClientToBroker[] = [];
	const socket = {
		send: (raw: string) => {
			const parsed = parseClientMessage(raw);
			if (parsed) outbound.push(parsed);
		},
		close: () => {},
	};
	const opened: {
		sessionId: string;
		toDevice: (m: HostMessage) => void;
		received: DeviceMessage[];
		closed: boolean;
	}[] = [];
	const client = createHostBrokerClient({
		hostKey: "HOSTKEY",
		socket,
		openSession: (sessionId, toDevice) => {
			const record = { sessionId, toDevice, received: [] as DeviceMessage[], closed: false };
			opened.push(record);
			const session: HostSession = {
				receive: (message) => void record.received.push(message),
				onChannel: () => {},
				close: () => {
					record.closed = true;
				},
			};
			return session;
		},
	});
	return { client, outbound, opened };
}

test("start registers the host by key", () => {
	const { client, outbound } = fixture();
	client.start();
	expect(outbound).toEqual([{ t: "register", hostKey: "HOSTKEY" }]);
});

test("an opened session is created and device frames route into it", () => {
	const { client, opened } = fixture();
	client.receive(JSON.stringify({ t: "open", session: "S1" }));
	expect(client.sessionCount).toBe(1);

	const hello = { kind: "hello", token: "t", devicePublicKey: "k", label: "Phone" };
	client.receive(JSON.stringify({ t: "frame", session: "S1", data: JSON.stringify(hello) }));
	expect(opened[0]?.received).toEqual([hello as DeviceMessage]);
});

test("host signaling for a session is framed back through the broker", () => {
	const { client, outbound, opened } = fixture();
	client.receive(JSON.stringify({ t: "open", session: "S1" }));
	opened[0]?.toDevice({ kind: "challenge", challenge: "CH" });
	expect(outbound.at(-1)).toEqual({
		t: "frame",
		session: "S1",
		data: JSON.stringify({ kind: "challenge", challenge: "CH" }),
	});
});

test("close ends the session; unknown sessions and malformed frames are ignored", () => {
	const { client, opened } = fixture();
	client.receive(JSON.stringify({ t: "open", session: "S1" }));
	client.receive(JSON.stringify({ t: "frame", session: "ghost", data: "{}" }));
	client.receive("not json");
	client.receive(JSON.stringify({ t: "close", session: "S1" }));
	expect(opened[0]?.closed).toBe(true);
	expect(client.sessionCount).toBe(0);
});
