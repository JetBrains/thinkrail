import { networkInterfaces } from "node:os";
import { startBroker } from "@thinkrail/relay";
import { discoverPublicAddress } from "./publicAddress";

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
	/** Where a phone can reach it: Wi‑Fi/LAN addresses first, then Tailscale, then public. */
	readonly addresses: readonly RelayAddress[];
	/** Settles once the public address behind NAT has been looked for, so a first QR can carry it. */
	readonly ready: Promise<void>;
	stop(): void;
}

type Interfaces = ReturnType<typeof networkInterfaces>;

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

/**
 * Runs the signaling relay inside the host, so `--remote` needs no separately started relay: it listens on all
 * interfaces at the fixed port (so a paired phone's saved addresses survive a restart), or a free one when that
 * is taken.
 */
export function startLocalRelay(
	port = LOCAL_RELAY_PORT,
	discoverPublic: (port: number) => Promise<string | undefined> = discoverPublicAddress,
): LocalRelay {
	let running: ReturnType<typeof startBroker>;
	try {
		running = startBroker({ port, host: "0.0.0.0" });
	} catch {
		running = startBroker({ port: 0, host: "0.0.0.0" });
	}
	let stopped = false;
	let addresses = relayAddresses(running.port);
	const ready = addresses.some((address) => address.route === "public")
		? Promise.resolve()
		: discoverPublic(running.port)
				.then((ip) => {
					if (ip === undefined || stopped) return;
					const url = `ws://${ip}:${running.port}`;
					if (!addresses.some((address) => address.url === url)) {
						addresses = [...addresses, { url, route: "public" }];
					}
				})
				.catch(() => {});
	return {
		connectUrl: `ws://127.0.0.1:${running.port}`,
		get addresses() {
			return addresses;
		},
		ready,
		stop: () => {
			stopped = true;
			running.stop();
		},
	};
}
