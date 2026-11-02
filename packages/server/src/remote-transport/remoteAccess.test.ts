import { expect, test } from "bun:test";
import { parsePairingUri } from "../remote";
import type { HostBrokerClient, HostBrokerDeps } from "./hostBrokerClient";
import { startRemoteAccess } from "./remoteAccess";

const identity = {
	publicKey: "HOSTPUBKEY",
	fingerprint: "fp",
	sign: () => new Uint8Array(),
};

function fakeConnect() {
	const captured: { url?: string; deps?: Omit<HostBrokerDeps, "socket"> } = {};
	let stopped = false;
	const connect = (url: string, deps: Omit<HostBrokerDeps, "socket">): HostBrokerClient => {
		captured.url = url;
		captured.deps = deps;
		return {
			start: () => {},
			receive: () => {},
			stop: () => {
				stopped = true;
			},
			get sessionCount() {
				return 0;
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

	const parsed = parsePairingUri(access.issueLink("proj-42"));
	expect(parsed).toMatchObject({
		signalingUrls: ["ws://relay:1"],
		hostPublicKey: "HOSTPUBKEY",
		projectRef: "proj-42",
	});
	expect(parsed?.token).toBeString();
	expect(parsed?.token.length).toBeGreaterThan(0);

	// One-time: two links carry distinct tokens.
	expect(parsePairingUri(access.issueLink("proj-42"))?.token).not.toBe(parsed?.token);
});

test("the link carries the advertised relay addresses and the host name instead of the connect URL", () => {
	const { connect } = fakeConnect();
	const access = startRemoteAccess({
		relayUrl: "ws://127.0.0.1:24243",
		advertised: [
			{ url: "ws://192.168.0.20:24243", route: "lan" },
			{ url: "ws://100.101.102.103:24243", route: "tailscale" },
		],
		hostName: "Studio Mac",
		identity,
		connect,
	});
	expect(parsePairingUri(access.issueLink("p"))).toMatchObject({
		signalingUrls: ["ws://192.168.0.20:24243", "ws://100.101.102.103:24243"],
		hostName: "Studio Mac",
	});
	expect(access.addresses.map((address) => address.route)).toEqual(["lan", "tailscale"]);
});

test("stop tears down the broker client", () => {
	const { connect, isStopped } = fakeConnect();
	startRemoteAccess({ relayUrl: "ws://relay:1", identity, connect }).stop();
	expect(isStopped()).toBe(true);
});
