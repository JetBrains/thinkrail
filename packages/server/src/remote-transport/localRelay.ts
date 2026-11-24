import { networkInterfaces } from "node:os";
import type { RemotePublicCheck } from "@thinkrail/contracts";
import { startBroker } from "@thinkrail/relay";
import { discoverPublicAddress, type PublicDiscovery } from "./publicAddress";

export const LOCAL_RELAY_PORT = 24243;

/** How a device reaches the relay: this machine's Wi‑Fi/LAN, Tailscale or public address, or a configured relay. */
export type RelayRoute = "lan" | "tailscale" | "public" | "relay";

export interface RelayAddress {
	url: string;
	route: RelayRoute;
}

export interface LocalRelay {
	/** Where the host itself connects (loopback). */
	readonly connectUrl: string;
	readonly port: number;
	/** Where a phone can reach it, read live: Wi‑Fi/LAN first, then Tailscale, then public. */
	readonly addresses: readonly RelayAddress[];
	/** Whether the internet reaches this relay, re-checked whenever this machine's addresses change. */
	readonly publicCheck: RemotePublicCheck;
	/** Settles once the current public check has, so a first QR can carry what it finds. */
	readonly ready: Promise<void>;
	stop(): void;
}

type Interfaces = ReturnType<typeof networkInterfaces>;

export interface LocalRelayDeps {
	interfaces?: () => Interfaces;
	discoverPublic?: (port: number) => Promise<PublicDiscovery>;
}

const octets = (ip: string): number[] => ip.split(".").map((part) => Number.parseInt(part, 10));

/** Tailscale hands out CGNAT-range addresses (100.64.0.0/10). */
const isTailscale = ([a, b = 0]: number[]): boolean => a === 100 && b >= 64 && b < 128;

const isPrivateLan = ([a, b = 0]: number[]): boolean =>
	a === 10 || (a === 172 && b >= 16 && b < 32) || (a === 192 && b === 168);

const isLinkLocal = ([a, b = 0]: number[]): boolean => a === 169 && b === 254;

/** Every IPv4 address of this machine a phone could reach the relay at, LAN before Tailscale before public. */
export function relayAddresses(
	port: number,
	interfaces: Interfaces = networkInterfaces(),
): RelayAddress[] {
	const lan: RelayAddress[] = [];
	const tailscale: RelayAddress[] = [];
	const publicAddresses: RelayAddress[] = [];
	for (const entries of Object.values(interfaces)) {
		for (const entry of entries ?? []) {
			if (entry.family !== "IPv4" || entry.internal) continue;
			const parts = octets(entry.address);
			const url = `ws://${entry.address}:${port}`;
			if (isTailscale(parts)) tailscale.push({ url, route: "tailscale" });
			else if (isPrivateLan(parts)) lan.push({ url, route: "lan" });
			else if (!isLinkLocal(parts)) publicAddresses.push({ url, route: "public" });
		}
	}
	return [...lan, ...tailscale, ...publicAddresses];
}

export function startLocalRelay(port = LOCAL_RELAY_PORT, deps: LocalRelayDeps = {}): LocalRelay {
	const interfaces = deps.interfaces ?? networkInterfaces;
	const discoverPublic = deps.discoverPublic ?? discoverPublicAddress;
	let running: ReturnType<typeof startBroker>;
	try {
		running = startBroker({ port, host: "0.0.0.0" });
	} catch {
		running = startBroker({ port: 0, host: "0.0.0.0" });
	}
	const boundPort = running.port;
	let stopped = false;
	let checkedFor: string | null = null;
	let publicCheck: RemotePublicCheck = { state: "checking" };
	let pending: Promise<void> = Promise.resolve();

	const local = (): RelayAddress[] => {
		const addresses = relayAddresses(boundPort, interfaces());
		const fingerprint = addresses.map((address) => address.url).join(" ");
		if (fingerprint === checkedFor || stopped) return addresses;
		checkedFor = fingerprint;
		const onInterface = addresses.find((address) => address.route === "public");
		if (onInterface) {
			publicCheck = { state: "interface", ip: new URL(onInterface.url).hostname };
			pending = Promise.resolve();
		} else {
			publicCheck = { state: "checking" };
			pending = discoverPublic(boundPort)
				.catch((): PublicDiscovery => ({ state: "offline" }))
				.then((found) => {
					if (checkedFor === fingerprint && !stopped) publicCheck = found;
				});
		}
		return addresses;
	};
	local();

	return {
		connectUrl: `ws://127.0.0.1:${boundPort}`,
		port: boundPort,
		get addresses() {
			const addresses = local();
			if (publicCheck.state !== "reachable") return addresses;
			const found: RelayAddress = { url: `ws://${publicCheck.ip}:${boundPort}`, route: "public" };
			return [...addresses, found];
		},
		get publicCheck() {
			local();
			return publicCheck;
		},
		get ready() {
			local();
			return pending;
		},
		stop: () => {
			stopped = true;
			running.stop();
		},
	};
}
