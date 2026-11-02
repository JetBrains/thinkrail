import { expect, test } from "bun:test";
import { relayAddresses, startLocalRelay } from "./localRelay";

const entry = (address: string, internal = false) => ({
	address,
	netmask: "255.255.255.0",
	family: "IPv4" as const,
	mac: "00:00:00:00:00:00",
	internal,
	cidr: null,
});

test("lists LAN addresses before Tailscale ones and skips loopback, public and IPv6 addresses", () => {
	const addresses = relayAddresses(24243, {
		lo0: [entry("127.0.0.1", true)],
		utun4: [entry("100.101.102.103")],
		en0: [entry("192.168.0.20"), { ...entry("fe80::1"), family: "IPv6" as const, scopeid: 0 }],
		en1: [entry("10.1.2.3"), entry("8.8.8.8")],
		bridge: [entry("172.20.0.1")],
	});
	expect(addresses).toEqual([
		{ url: "ws://192.168.0.20:24243", route: "lan" },
		{ url: "ws://10.1.2.3:24243", route: "lan" },
		{ url: "ws://172.20.0.1:24243", route: "lan" },
		{ url: "ws://100.101.102.103:24243", route: "tailscale" },
	]);
});

test("falls back to a free port when the fixed one is taken, and answers health checks", async () => {
	const first = startLocalRelay(0);
	const port = Number(new URL(first.connectUrl).port);
	const second = startLocalRelay(port);
	try {
		expect(Number(new URL(second.connectUrl).port)).not.toBe(port);
		const health = await fetch(`http://127.0.0.1:${new URL(second.connectUrl).port}/health`);
		expect(await health.text()).toBe("ok");
	} finally {
		first.stop();
		second.stop();
	}
});
