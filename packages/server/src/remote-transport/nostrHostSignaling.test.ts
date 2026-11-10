import { describe, expect, test } from "bun:test";
import {
	encodeDeviceMessage,
	encodeHostMessage,
	type HostMessage,
	parseHostMessage,
} from "@thinkrail/contracts";
import { generateNostrSecret, openNostrSignal } from "@thinkrail/nostr-signaling";
import { startTestNostrRelay } from "@thinkrail/nostr-signaling/testing";
import type { HostSession } from "./hostSession";
import { connectNostrHost, createNostrHostRouter } from "./nostrHostSignaling";
import type { DeviceMessage } from "./signalingProtocol";

const hello = encodeDeviceMessage({ kind: "resume", devicePublicKey: "DEV", nonce: "n" });

function fakeSessions() {
	const log: string[] = [];
	const sessions: {
		id: string;
		received: DeviceMessage[];
		toDevice: (m: HostMessage) => void;
		opened: boolean;
	}[] = [];
	const openSession = (id: string, toDevice: (m: HostMessage) => void): HostSession => {
		const record = { id, received: [] as DeviceMessage[], toDevice, opened: false };
		sessions.push(record);
		return {
			receive: (m) => void record.received.push(m),
			receiveUnreadable: () => void log.push(`unreadable:${id}`),
			onChannel: () => {},
			get opened() {
				return record.opened;
			},
			close: () => void log.push(`close:${id}`),
		};
	};
	return { log, sessions, openSession };
}

describe("createNostrHostRouter", () => {
	test("one session per device key; host frames go back to that key", () => {
		const { sessions, openSession } = fakeSessions();
		const sent: [string, string][] = [];
		const router = createNostrHostRouter({
			openSession,
			send: (to, data) => void sent.push([to, data]),
			forget: () => {},
		});
		router.receive("a", hello);
		router.receive("a", hello);
		router.receive("b", hello);
		expect(sessions.map((s) => [s.id, s.received.length])).toEqual([
			["nostr:a", 2],
			["nostr:b", 1],
		]);
		sessions[0]?.toDevice({ kind: "challenge", challenge: "c" });
		expect(sent).toEqual([["a", encodeHostMessage({ kind: "challenge", challenge: "c" })]]);
	});

	test("an unparseable frame is the outdated-app path, not a silent drop", () => {
		const { log, openSession } = fakeSessions();
		const router = createNostrHostRouter({ openSession, send: () => {}, forget: () => {} });
		router.receive("a", "garbage");
		expect(log).toEqual(["unreadable:nostr:a"]);
	});

	test("sessions expire after their window; an open channel is forgotten, not closed", () => {
		let now = 0;
		const { log, sessions, openSession } = fakeSessions();
		const forgotten: string[] = [];
		const router = createNostrHostRouter({
			openSession,
			send: () => {},
			forget: (peer) => void forgotten.push(peer),
			now: () => now,
		});
		router.receive("idle", hello);
		router.receive("live", hello);
		const live = sessions[1];
		if (live) live.opened = true;
		now = 59_000;
		router.sweep();
		expect(router.sessionCount).toBe(2);
		now = 61_000;
		router.sweep();
		expect(router.sessionCount).toBe(0);
		expect(log).toEqual(["close:nostr:idle"]);
		expect(forgotten.sort()).toEqual(["idle", "live"]);
	});

	test("caps live sessions and frames per session", () => {
		const { log, sessions, openSession } = fakeSessions();
		const router = createNostrHostRouter({ openSession, send: () => {}, forget: () => {} });
		for (let i = 0; i < 40; i += 1) router.receive(`k${i}`, hello);
		expect(sessions).toHaveLength(32);
		for (let i = 0; i < 70; i += 1) router.receive("k0", hello);
		expect(log).toEqual(["close:nostr:k0"]);
		expect(sessions[0]?.received).toHaveLength(64);
		expect(router.sessionCount).toBe(32);
	});
});

test("connectNostrHost routes a device's frames over a relay and answers it", async () => {
	const relay = startTestNostrRelay();
	const { sessions, openSession } = fakeSessions();
	const host = connectNostrHost({
		secretKey: generateNostrSecret(),
		relays: [relay.url],
		openSession,
	});
	const replies: HostMessage[] = [];
	const device = openNostrSignal({
		secretKey: generateNostrSecret(),
		relays: [relay.url],
		onMessage: (_from, data) => {
			const message = parseHostMessage(data);
			if (message) replies.push(message);
		},
	});
	try {
		expect(host.relays).toEqual([relay.url]);
		await device.ready;
		const deadline = Date.now() + 3_000;
		while (sessions.length === 0 && Date.now() < deadline) {
			await device.send(host.publicKey, hello);
			await Bun.sleep(100);
		}
		expect(sessions[0]?.received[0]).toEqual({
			kind: "resume",
			devicePublicKey: "DEV",
			nonce: "n",
		});
		sessions[0]?.toDevice({ kind: "challenge", challenge: "c" });
		while (replies.length === 0 && Date.now() < deadline) await Bun.sleep(20);
		expect(replies[0]).toEqual({ kind: "challenge", challenge: "c" });
	} finally {
		device.close();
		host.stop();
		relay.stop();
	}
});
