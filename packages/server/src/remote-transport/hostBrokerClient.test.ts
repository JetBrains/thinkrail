import { expect, test } from "bun:test";
import { type ClientToBroker, parseClientMessage, registerTranscript } from "@thinkrail/contracts";
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
		unreadable: number;
		closed: boolean;
	}[] = [];
	const client = createHostBrokerClient({
		hostKey: "HOSTKEY",
		sign: (data) => new TextEncoder().encode(`signed:${new TextDecoder().decode(data)}`),
		openSession: (sessionId, toDevice) => {
			const record = {
				sessionId,
				toDevice,
				received: [] as DeviceMessage[],
				unreadable: 0,
				closed: false,
			};
			opened.push(record);
			const session: HostSession = {
				receive: (message) => void record.received.push(message),
				receiveUnreadable: () => {
					record.unreadable += 1;
				},
				onChannel: () => {},
				close: () => {
					record.closed = true;
				},
			};
			return session;
		},
	});
	client.attach(socket);
	return { client, outbound, opened, socket };
}

test("attach registers the host by key and answers the broker's challenge with a signature", () => {
	const { client, outbound } = fixture();
	expect(outbound).toEqual([{ t: "register", hostKey: "HOSTKEY" }]);
	client.receive(JSON.stringify({ t: "challenge", nonce: "N1" }));
	const prove = outbound.at(-1);
	if (prove?.t !== "prove") throw new Error("expected a proof");
	expect(Buffer.from(prove.signature, "base64url").toString()).toBe(
		`signed:${new TextDecoder().decode(registerTranscript("N1"))}`,
	);
	expect(client.registered).toBe(false);
	client.receive(JSON.stringify({ t: "registered" }));
	expect(client.registered).toBe(true);
});

test("an opened session is created and device frames route into it", () => {
	const { client, opened } = fixture();
	client.receive(JSON.stringify({ t: "open", session: "S1" }));
	expect(client.sessionCount).toBe(1);

	const resume = { kind: "resume", devicePublicKey: "k", nonce: "n" };
	client.receive(JSON.stringify({ t: "frame", session: "S1", data: JSON.stringify(resume) }));
	expect(opened[0]?.received).toEqual([resume as DeviceMessage]);
});

test("a frame the host cannot read reaches the session as unreadable instead of vanishing", () => {
	const { client, opened } = fixture();
	client.receive(JSON.stringify({ t: "open", session: "S1" }));
	const oldHello = {
		kind: "hello",
		token: "raw",
		devicePublicKey: "k",
		label: "Phone",
		nonce: "n",
	};
	client.receive(JSON.stringify({ t: "frame", session: "S1", data: JSON.stringify(oldHello) }));
	expect(opened[0]?.received).toEqual([]);
	expect(opened[0]?.unreadable).toBe(1);
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

test("a dropped broker connection closes its sessions, and a reattach registers again", () => {
	const { client, outbound, opened, socket } = fixture();
	client.receive(JSON.stringify({ t: "registered" }));
	client.receive(JSON.stringify({ t: "open", session: "S1" }));
	client.detach();
	expect(opened[0]?.closed).toBe(true);
	expect(client.sessionCount).toBe(0);
	expect(client.registered).toBe(false);

	client.attach(socket);
	expect(outbound.at(-1)).toEqual({ t: "register", hostKey: "HOSTKEY" });
});
