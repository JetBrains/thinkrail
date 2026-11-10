import { afterEach, describe, expect, test } from "bun:test";
import { generateNostrSecret, type NostrSignal, openNostrSignal } from "./nostrSignal";
import { startTestNostrRelay, type TestNostrRelay } from "./testing";

const cleanup: (() => void)[] = [];
afterEach(() => {
	for (const fn of cleanup.splice(0)) fn();
});

function relay(): TestNostrRelay {
	const r = startTestNostrRelay();
	cleanup.push(() => r.stop());
	return r;
}

function signal(relays: string[], inbox: [string, string][]): NostrSignal {
	const s = openNostrSignal({
		secretKey: generateNostrSecret(),
		relays,
		onMessage: (from, data) => inbox.push([from, data]),
		readyTimeoutMs: 2_000,
	});
	cleanup.push(() => s.close());
	return s;
}

async function until(check: () => boolean, ms = 3_000): Promise<void> {
	const end = Date.now() + ms;
	while (!check()) {
		if (Date.now() > end) throw new Error("timed out");
		await Bun.sleep(10);
	}
}

describe("openNostrSignal", () => {
	test("exchanges encrypted frames both ways, once each, across duplicate relays", async () => {
		const relays = [relay().url, relay().url];
		const hostInbox: [string, string][] = [];
		const deviceInbox: [string, string][] = [];
		const host = signal(relays, hostInbox);
		const device = signal(relays, deviceInbox);
		await Promise.all([host.ready, device.ready]);

		await device.send(host.publicKey, "hello");
		await device.send(host.publicKey, "proof");
		await until(() => hostInbox.length === 2);
		expect(hostInbox).toEqual([
			[device.publicKey, "hello"],
			[device.publicKey, "proof"],
		]);

		await host.send(device.publicKey, "challenge");
		await until(() => deviceInbox.length === 1);
		expect(deviceInbox).toEqual([[host.publicKey, "challenge"]]);
		await Bun.sleep(50);
		expect(hostInbox).toHaveLength(2);
	});

	test("a dead relay in the list does not block the live one", async () => {
		const live = relay().url;
		const hostInbox: [string, string][] = [];
		const host = signal([live, "ws://127.0.0.1:1"], hostInbox);
		const device = signal([live, "ws://127.0.0.1:1"], []);
		await Promise.all([host.ready, device.ready]);
		await device.send(host.publicKey, "hello");
		await until(() => hostInbox.length === 1);
	});

	test("ready rejects when no relay answers", async () => {
		const s = signal(["ws://127.0.0.1:1"], []);
		await expect(s.ready).rejects.toThrow("no Nostr relay answered");
	});

	test("a third party cannot read frames addressed to someone else", async () => {
		const relays = [relay().url];
		const hostInbox: [string, string][] = [];
		const eavesdropperInbox: [string, string][] = [];
		const host = signal(relays, hostInbox);
		const device = signal(relays, []);
		signal(relays, eavesdropperInbox);
		await Promise.all([host.ready, device.ready]);
		await device.send(host.publicKey, "secret");
		await until(() => hostInbox.length === 1);
		expect(eavesdropperInbox).toEqual([]);
	});
});
