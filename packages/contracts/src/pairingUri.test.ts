import { describe, expect, test } from "bun:test";
import {
	buildPairingUri,
	type PairingUriParams,
	parsePairingUri,
	parseRemoteHostRoutes,
} from "./pairingUri";

const params: PairingUriParams = {
	signalingUrls: ["ws://192.168.0.20:24243", "ws://100.101.102.103:24243"],
	token: "tok_abc-123",
	hostPublicKey: "PUBKEY_B64URL",
	projectRef: "proj-42",
	hostName: "Studio Mac",
};

test("build then parse round-trips every field, keeping the relay order", () => {
	expect(parsePairingUri(buildPairingUri(params))).toEqual(params);
});

test("a link with one relay and no host name still parses", () => {
	expect(parsePairingUri("thinkrail://pair?v=1&s=ws%3A%2F%2Fa&t=b&k=c&p=d")).toEqual({
		signalingUrls: ["ws://a"],
		token: "b",
		hostPublicKey: "c",
		projectRef: "d",
	});
});

const NOSTR_KEY = "a".repeat(64);

test("a Nostr route round-trips and is enough on its own", () => {
	const nostr = { publicKey: NOSTR_KEY, relays: ["wss://r1.example", "wss://r2.example"] };
	expect(parsePairingUri(buildPairingUri({ ...params, nostr }))).toEqual({ ...params, nostr });
	expect(parsePairingUri(buildPairingUri({ ...params, signalingUrls: [], nostr }))).toEqual({
		...params,
		signalingUrls: [],
		nostr,
	});
});

test("a malformed Nostr route is dropped, and with no relay address the link is invalid", () => {
	const base = "thinkrail://pair?v=1&t=b&k=c&p=d";
	expect(parsePairingUri(`${base}&o=xyz&r=wss%3A%2F%2Fr`)).toBeNull();
	expect(parsePairingUri(`${base}&o=${NOSTR_KEY}`)).toBeNull();
	expect(parsePairingUri(`${base}&s=ws%3A%2F%2Fa&o=xyz&r=wss%3A%2F%2Fr`)?.nostr).toBeUndefined();
});

test("rejects a wrong scheme, host, version, or missing field", () => {
	expect(parsePairingUri("https://pair?v=1&s=a&t=b&k=c&p=d")).toBeNull();
	expect(parsePairingUri("thinkrail://other?v=1&s=a&t=b&k=c&p=d")).toBeNull();
	expect(parsePairingUri("thinkrail://pair?v=2&s=a&t=b&k=c&p=d")).toBeNull();
	expect(parsePairingUri("thinkrail://pair?v=1&s=a&t=b&k=c")).toBeNull();
	expect(parsePairingUri("thinkrail://pair?v=1&t=b&k=c&p=d")).toBeNull();
	expect(parsePairingUri("not a uri at all")).toBeNull();
});

describe("parseRemoteHostRoutes", () => {
	const key = "a".repeat(64);

	test("keeps relay addresses and a well-formed Nostr route", () => {
		expect(
			parseRemoteHostRoutes({
				signalingUrls: ["ws://192.168.1.5:7000", "wss://host.ts.net"],
				nostr: { publicKey: key, relays: ["wss://relay.one"] },
			}),
		).toEqual({
			signalingUrls: ["ws://192.168.1.5:7000", "wss://host.ts.net"],
			nostr: { publicKey: key, relays: ["wss://relay.one"] },
		});
	});

	test("drops non-socket addresses and a malformed Nostr route", () => {
		expect(
			parseRemoteHostRoutes({
				signalingUrls: ["http://x", 3, "ws://ok"],
				nostr: { publicKey: "nothex", relays: ["wss://relay.one"] },
			}),
		).toEqual({ signalingUrls: ["ws://ok"] });
	});

	test("a push with no usable route is null", () => {
		expect(parseRemoteHostRoutes(null)).toBeNull();
		expect(parseRemoteHostRoutes({ signalingUrls: [] })).toBeNull();
		expect(parseRemoteHostRoutes({ nostr: { publicKey: key, relays: [] } })).toBeNull();
	});
});
