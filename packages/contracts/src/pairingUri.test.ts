import { expect, test } from "bun:test";
import { buildPairingUri, type PairingUriParams, parsePairingUri } from "./pairingUri";

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

test("rejects a wrong scheme, host, version, or missing field", () => {
	expect(parsePairingUri("https://pair?v=1&s=a&t=b&k=c&p=d")).toBeNull();
	expect(parsePairingUri("thinkrail://other?v=1&s=a&t=b&k=c&p=d")).toBeNull();
	expect(parsePairingUri("thinkrail://pair?v=2&s=a&t=b&k=c&p=d")).toBeNull();
	expect(parsePairingUri("thinkrail://pair?v=1&s=a&t=b&k=c")).toBeNull();
	expect(parsePairingUri("thinkrail://pair?v=1&t=b&k=c&p=d")).toBeNull();
	expect(parsePairingUri("not a uri at all")).toBeNull();
});
