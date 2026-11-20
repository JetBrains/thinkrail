import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type HostMessage, parsePairingUri } from "@thinkrail/contracts";
import { addDevice } from "../remote";
import type { BrokerConnection, HostBrokerDeps } from "./hostBrokerClient";
import type { RelayAddress } from "./localRelay";
import { startRemoteAccess } from "./remoteAccess";

const identity = {
	publicKey: "HOSTPUBKEY",
	fingerprint: "fp",
	sign: () => new Uint8Array(),
	nostrSecret: new Uint8Array(32).fill(1),
};

function fakeConnect() {
	const captured: { url?: string; deps?: HostBrokerDeps } = {};
	let stopped = false;
	const connect = (url: string, deps: HostBrokerDeps): BrokerConnection => {
		captured.url = url;
		captured.deps = deps;
		return {
			stop: () => {
				stopped = true;
			},
		};
	};
	return { connect, captured, isStopped: () => stopped };
}

test("connects to the relay with the host public key", () => {
	const { connect, captured } = fakeConnect();
	startRemoteAccess({ relayUrl: "ws://relay:1", identity, connect });
	expect(captured.url).toBe("ws://relay:1");
	expect(captured.deps?.hostKey).toBe("HOSTPUBKEY");
});

test("issueLink mints a parseable one-time pairing link for the project", () => {
	const { connect } = fakeConnect();
	const access = startRemoteAccess({ relayUrl: "ws://relay:1", identity, connect });

	const parsed = parsePairingUri(access.issueLink("proj-42").link);
	expect(parsed).toMatchObject({
		signalingUrls: ["ws://relay:1"],
		hostPublicKey: "HOSTPUBKEY",
		projectRef: "proj-42",
	});
	expect(parsed?.token).toBeString();
	expect(parsed?.token.length).toBeGreaterThan(0);

	// One-time: two links carry distinct tokens.
	expect(parsePairingUri(access.issueLink("proj-42").link)?.token).not.toBe(parsed?.token);
});

test("the link carries the advertised relay addresses and the host name instead of the connect URL", () => {
	const { connect } = fakeConnect();
	const advertised: RelayAddress[] = [
		{ url: "ws://192.168.0.20:24243", route: "lan" },
		{ url: "ws://100.101.102.103:24243", route: "tailscale" },
	];
	const access = startRemoteAccess({
		relayUrl: "ws://127.0.0.1:24243",
		advertised: () => advertised,
		hostName: "Studio Mac",
		identity,
		connect,
	});
	expect(parsePairingUri(access.issueLink("p").link)).toMatchObject({
		signalingUrls: ["ws://192.168.0.20:24243", "ws://100.101.102.103:24243"],
		hostName: "Studio Mac",
	});
	expect(access.addresses.map((address) => address.route)).toEqual(["lan", "tailscale"]);

	advertised.push({ url: "ws://203.0.113.7:24243", route: "public" });
	expect(parsePairingUri(access.issueLink("p").link)?.signalingUrls).toContain(
		"ws://203.0.113.7:24243",
	);
});

test("stop tears down the broker client", () => {
	const { connect, isStopped } = fakeConnect();
	startRemoteAccess({ relayUrl: "ws://relay:1", identity, connect }).stop();
	expect(isStopped()).toBe(true);
});

test("routes follow the advertised addresses and carry the Nostr route the link does", () => {
	const { connect } = fakeConnect();
	const advertised: RelayAddress[] = [{ url: "ws://192.168.0.20:24243", route: "lan" }];
	const nostrKey = "b".repeat(64);
	const access = startRemoteAccess({
		relayUrl: "ws://127.0.0.1:24243",
		advertised: () => advertised,
		identity,
		connect,
		nostrRelays: ["wss://relay.one"],
		connectNostr: () => ({
			publicKey: nostrKey,
			relays: ["wss://relay.one"],
			connectedRelays: () => 1,
			stop: () => {},
		}),
	});
	const nostr = { publicKey: nostrKey, relays: ["wss://relay.one"] };
	expect(access.routes()).toEqual({ signalingUrls: ["ws://192.168.0.20:24243"], nostr });
	expect(parsePairingUri(access.issueLink("p").link)?.nostr).toEqual(nostr);

	advertised[0] = { url: "ws://10.0.0.9:24243", route: "lan" };
	expect(access.routes().signalingUrls).toEqual(["ws://10.0.0.9:24243"]);
});

test("the identity and device registry are read under the given data dir", () => {
	const dir = mkdtempSync(join(tmpdir(), "trpi-remote-access-"));
	try {
		addDevice({ id: "d1", label: "Phone", publicKey: "PHONEKEY", pairedAt: 1 }, dir);
		const { connect, captured } = fakeConnect();
		const access = startRemoteAccess({
			relayUrl: "ws://relay:1",
			dataDir: dir,
			connect,
			portMapper: null,
		});
		expect(existsSync(join(dir, "remote-identity.json"))).toBe(true);

		const sent: HostMessage[] = [];
		const session = captured.deps?.openSession("S1", (message) => sent.push(message));
		session?.receive({ kind: "resume", devicePublicKey: "PHONEKEY", nonce: "N" });
		expect(sent.map((message) => message.kind)).toEqual(["challenge"]);
		session?.close();
		access.stop();
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
