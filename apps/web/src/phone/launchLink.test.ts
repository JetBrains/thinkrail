import { expect, test } from "bun:test";
import { buildPairingUri } from "@thinkrail/contracts";
import type { KeyValueStore } from "@thinkrail/remote-client";
import { launchLinkToPair, markPairLinkHandled } from "./launchLink";

const memoryStore = (): KeyValueStore => {
	const values = new Map<string, string>();
	return { read: (key) => values.get(key) ?? null, write: (key, value) => values.set(key, value) };
};

const link = buildPairingUri({
	signalingUrls: ["ws://192.168.1.2:24243"],
	token: "one-time",
	hostPublicKey: "HOST",
	projectRef: "p",
});

test("a fresh launch link for a new computer pairs, once", () => {
	const store = memoryStore();
	expect(launchLinkToPair(` ${link} `, store, [])).toBe(link);
	markPairLinkHandled(store, link);
	expect(launchLinkToPair(link, store, [])).toBeNull();
});

test("a launch link for a computer already kept, or anything but a pairing link, is left alone", () => {
	expect(launchLinkToPair(link, memoryStore(), ["HOST"])).toBeNull();
	expect(launchLinkToPair("https://example.com", memoryStore(), [])).toBeNull();
	expect(launchLinkToPair(undefined, memoryStore(), [])).toBeNull();
});
