import { networkInterfaces } from "node:os";
import { startBroker } from "@thinkrail/relay";

export const LOCAL_RELAY_PORT = 24243;

/** How a device reaches the relay: this machine's Wi‑Fi/LAN or Tailscale address, or a configured relay. */
export type RelayRoute = "lan" | "tailscale" | "relay";

export interface RelayAddress {
	url: string;
	route: RelayRoute;
}

export interface LocalRelay {
	/** Where the host itself connects (loopback). */
	readonly connectUrl: string;
	/** Where a phone can reach it: Wi‑Fi/LAN addresses first, then Tailscale. */
	readonly addresses: readonly RelayAddress[];
	stop(): void;
}

type Interfaces = ReturnType<typeof networkInterfaces>;

const octets = (ip: string): number[] => ip.split(".").map((part) => Number.parseInt(part, 10));

/** Tailscale hands out CGNAT-range addresses (100.64.0.0/10). */
const isTailscale = ([a, b = 0]: number[]): boolean => a === 100 && b >= 64 && b < 128;

const isPrivateLan = ([a, b = 0]: number[]): boolean =>
	a === 10 || (a === 172 && b >= 16 && b < 32) || (a === 192 && b === 168);

/** Every IPv4 address of this machine a phone could reach the relay at, LAN before Tailscale. */
export function relayAddresses(
	port: number,
	interfaces: Interfaces = networkInterfaces(),
): RelayAddress[] {
	const lan: RelayAddress[] = [];
	const tailscale: RelayAddress[] = [];
	for (const entries of Object.values(interfaces)) {
		for (const entry of entries ?? []) {
			if (entry.family !== "IPv4" || entry.internal) continue;
			const parts = octets(entry.address);
			const url = `ws://${entry.address}:${port}`;
			if (isTailscale(parts)) tailscale.push({ url, route: "tailscale" });
			else if (isPrivateLan(parts)) lan.push({ url, route: "lan" });
		}
	}
	return [...lan, ...tailscale];
}

/**
 * Runs the signaling relay inside the host, so `--remote` needs no separately started relay: it listens on all
 * interfaces at the fixed port (so a paired phone's saved addresses survive a restart), or a free one when that
 * is taken.
 */
export function startLocalRelay(port = LOCAL_RELAY_PORT): LocalRelay {
	let running: ReturnType<typeof startBroker>;
	try {
		running = startBroker({ port, host: "0.0.0.0" });
	} catch {
		running = startBroker({ port: 0, host: "0.0.0.0" });
	}
	return {
		connectUrl: `ws://127.0.0.1:${running.port}`,
		addresses: relayAddresses(running.port),
		stop: () => running.stop(),
	};
}
