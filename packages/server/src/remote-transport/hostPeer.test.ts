import { expect, test } from "bun:test";
import {
	createWeriftHostPeer,
	type HostPeerSignal,
	mappablePort,
	mappedCandidate,
} from "./hostPeer";
import type { PortMapper } from "./natPmp";

test("the offer is signalled before any ICE candidate gathered while setting it", async () => {
	const peer = createWeriftHostPeer([]);
	const signals: HostPeerSignal["kind"][] = [];
	peer.onLocalSignal((signal) => signals.push(signal.kind));

	await peer.start();
	peer.close();

	expect(signals[0]).toBe("offer");
	expect(signals.slice(1).every((kind) => kind === "candidate")).toBe(true);
});

test("only a private-IPv4 UDP host candidate is one a router can forward to", () => {
	expect(mappablePort("candidate:abc 1 udp 2116026367 192.168.0.200 58167 typ host")).toEqual({
		address: "192.168.0.200",
		port: 58167,
	});
	expect(mappablePort("candidate:abc 1 udp 2116026367 172.20.1.4 1000 typ host")).not.toBeNull();
	expect(
		mappablePort("candidate:abc 1 udp 1 80.114.240.51 58167 typ srflx raddr 1 rport 2"),
	).toBeNull();
	expect(mappablePort("candidate:abc 1 tcp 1 192.168.0.200 9 typ host tcptype active")).toBeNull();
	expect(mappablePort("candidate:abc 1 udp 1 100.64.0.1 5000 typ host")).toBeNull();
	expect(mappablePort("candidate:abc 1 udp 1 fe80::1 5000 typ host")).toBeNull();
});

test("a mapped candidate is server-reflexive at the public address, related to the local port", () => {
	const json = mappedCandidate(
		{
			candidate: "candidate:abc 1 udp 1 192.168.0.200 58167 typ host",
			sdpMid: "0",
			sdpMLineIndex: 0,
		},
		{ address: "192.168.0.200", port: 58167 },
		{ address: "203.0.113.7", port: 40000 },
	);
	expect(JSON.parse(json)).toEqual({
		candidate:
			"candidate:pmp58167 1 udp 1694498815 203.0.113.7 40000 typ srflx raddr 192.168.0.200 rport 58167",
		sdpMid: "0",
		sdpMLineIndex: 0,
	});
});

test("each mappable local port is mapped once, its public candidate signalled, and released on close", async () => {
	const opened: number[] = [];
	let released = 0;
	const mapper: PortMapper = {
		open: async (port) => {
			opened.push(port);
			return { address: "203.0.113.7", port: 40000, release: () => void released++ };
		},
	};
	const peer = createWeriftHostPeer([], mapper);
	const candidates: string[] = [];
	peer.onLocalSignal((signal) => {
		if (signal.candidate) candidates.push(JSON.parse(signal.candidate).candidate as string);
	});
	await peer.start();
	const deadline = Date.now() + 2_000;
	while (!candidates.some((c) => c.includes("203.0.113.7")) && Date.now() < deadline)
		await Bun.sleep(10);
	const local = candidates.filter((c) => mappablePort(c));
	if (local.length === 0) {
		peer.close();
		return; // no private IPv4 interface on this machine (CI sandbox)
	}
	expect(opened.length).toBe(local.length);
	expect(candidates.some((c) => c.includes("203.0.113.7 40000 typ srflx"))).toBe(true);
	peer.close();
	expect(released).toBe(opened.length);
});
