import { expect, test } from "bun:test";
import { relayAddresses, startLocalRelay } from "./localRelay";

const noPublic = { discoverPublic: async () => ({ state: "offline" as const }) };

const entry = (address: string, internal = false) => ({
	address,
	netmask: "255.255.255.0",
	family: "IPv4" as const,
	mac: "00:00:00:00:00:00",
	internal,
	cidr: null,
});

test("lists LAN, then Tailscale, then public addresses and skips loopback, link-local and IPv6 ones", () => {
	const addresses = relayAddresses(24243, {
		lo0: [entry("127.0.0.1", true)],
		utun4: [entry("100.101.102.103")],
		en0: [entry("192.168.0.20"), { ...entry("fe80::1"), family: "IPv6" as const, scopeid: 0 }],
		en1: [entry("10.1.2.3"), entry("8.8.8.8")],
		bridge: [entry("172.20.0.1")],
		en2: [entry("169.254.3.4")],
	});
	expect(addresses).toEqual([
		{ url: "ws://192.168.0.20:24243", route: "lan" },
		{ url: "ws://10.1.2.3:24243", route: "lan" },
		{ url: "ws://172.20.0.1:24243", route: "lan" },
		{ url: "ws://100.101.102.103:24243", route: "tailscale" },
		{ url: "ws://8.8.8.8:24243", route: "public" },
	]);
});

test("adds the public address found behind NAT once the check settles", async () => {
	const looked: number[] = [];
	const relay = startLocalRelay(0, {
		interfaces: () => ({ en0: [entry("10.0.0.5")] }),
		discoverPublic: async (port) => {
			looked.push(port);
			return { state: "reachable", ip: "203.0.113.7" };
		},
	});
	try {
		expect(relay.publicCheck).toEqual({ state: "checking" });
		await relay.ready;
		expect(looked).toEqual([relay.port]);
		expect(relay.publicCheck).toEqual({ state: "reachable", ip: "203.0.113.7" });
		expect(relay.addresses).toEqual([
			{ url: `ws://10.0.0.5:${relay.port}`, route: "lan" },
			{ url: `ws://203.0.113.7:${relay.port}`, route: "public" },
		]);
	} finally {
		relay.stop();
	}
});

test("a closed public address is reported but never advertised", async () => {
	const relay = startLocalRelay(0, {
		interfaces: () => ({ en0: [entry("192.168.0.20")] }),
		discoverPublic: async () => ({ state: "closed", ip: "80.0.0.1" }),
	});
	try {
		await relay.ready;
		expect(relay.publicCheck).toEqual({ state: "closed", ip: "80.0.0.1" });
		expect(relay.addresses.map((address) => address.route)).toEqual(["lan"]);
	} finally {
		relay.stop();
	}
});

test("a public interface address needs no lookup", () => {
	let looked = false;
	const relay = startLocalRelay(0, {
		interfaces: () => ({ eth0: [entry("203.0.113.9")] }),
		discoverPublic: async () => {
			looked = true;
			return { state: "offline" };
		},
	});
	try {
		expect(relay.publicCheck).toEqual({ state: "interface", ip: "203.0.113.9" });
		expect(looked).toBe(false);
	} finally {
		relay.stop();
	}
});

test("addresses follow the network live and the public check reruns when they change", async () => {
	let interfaces: Record<string, ReturnType<typeof entry>[]> = { en0: [entry("192.168.0.20")] };
	let checks = 0;
	const relay = startLocalRelay(0, {
		interfaces: () => interfaces,
		discoverPublic: async () => {
			checks += 1;
			return { state: "offline" };
		},
	});
	try {
		await relay.ready;
		expect(relay.addresses.map((address) => address.route)).toEqual(["lan"]);
		interfaces = { en0: [entry("192.168.0.20")], utun4: [entry("100.101.102.103")] };
		expect(relay.addresses.map((address) => address.route)).toEqual(["lan", "tailscale"]);
		await relay.ready;
		expect(relay.addresses.map((address) => address.route)).toEqual(["lan", "tailscale"]);
		expect(checks).toBe(2);
	} finally {
		relay.stop();
	}
});

test("falls back to a free port when the fixed one is taken, and answers health checks", async () => {
	const first = startLocalRelay(0, noPublic);
	const port = Number(new URL(first.connectUrl).port);
	const second = startLocalRelay(port, noPublic);
	try {
		expect(Number(new URL(second.connectUrl).port)).not.toBe(port);
		const health = await fetch(`http://127.0.0.1:${new URL(second.connectUrl).port}/health`);
		expect(await health.text()).toBe("ok");
	} finally {
		first.stop();
		second.stop();
	}
});
