import { expect, test } from "bun:test";
import { buildPairingUri, type PairingUriParams, parsePairingUri } from "./pairingUri";

const params: PairingUriParams = {
	signalingUrl: "https://relay.example/s",
	token: "tok_abc-123",
	hostPublicKey: "PUBKEY_B64URL",
	projectRef: "proj-42",
};

test("build then parse round-trips every field", () => {
	expect(parsePairingUri(buildPairingUri(params))).toEqual(params);
});

test("rejects a wrong scheme, host, version, or missing field", () => {
	expect(parsePairingUri("https://pair?v=1&s=a&t=b&k=c&p=d")).toBeNull();
	expect(parsePairingUri("thinkrail://other?v=1&s=a&t=b&k=c&p=d")).toBeNull();
	expect(parsePairingUri("thinkrail://pair?v=2&s=a&t=b&k=c&p=d")).toBeNull();
	expect(parsePairingUri("thinkrail://pair?v=1&s=a&t=b&k=c")).toBeNull();
	expect(parsePairingUri("not a uri at all")).toBeNull();
});
