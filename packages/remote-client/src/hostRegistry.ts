import type { PairingNostrRoute, RemoteHostRoutes } from "@thinkrail/contracts";

export interface SavedHost {
	hostKey: string;
	/** The address that last answered; kept for hosts paired before links carried several. */
	relayUrl: string;
	/** Every relay address from the pairing link (Wi‑Fi/LAN, Tailscale); a reconnect races them. */
	relayUrls?: readonly string[];
	/** The host's Nostr route from the pairing link, so a reconnect works from any network. */
	nostr?: PairingNostrRoute;
	label: string;
	pairedAt: number;
}

/** A minimal string key/value store, so the registry persists in web localStorage or Capacitor Preferences. */
export interface KeyValueStore {
	read(key: string): string | null;
	write(key: string, value: string): void;
}

export interface HostRegistry {
	list(): SavedHost[];
	add(host: SavedHost): SavedHost[];
	/** Replaces a saved host in place; a host no longer saved stays forgotten. */
	update(host: SavedHost): SavedHost[];
	remove(hostKey: string): SavedHost[];
}

const REGISTRY_KEY = "thinkrail.remote.hosts";

/** The locally-stored set of paired hosts (no cloud account): the device pairs each host by link and remembers it. */
export function createHostRegistry(store: KeyValueStore): HostRegistry {
	const load = (): SavedHost[] => {
		const raw = store.read(REGISTRY_KEY);
		if (!raw) return [];
		try {
			const parsed = JSON.parse(raw) as unknown;
			return Array.isArray(parsed) ? (parsed as SavedHost[]) : [];
		} catch {
			return [];
		}
	};
	const save = (hosts: SavedHost[]): SavedHost[] => {
		store.write(REGISTRY_KEY, JSON.stringify(hosts));
		return hosts;
	};
	return {
		list: load,
		add(host) {
			const hosts = load().filter((h) => h.hostKey !== host.hostKey);
			hosts.push(host);
			return save(hosts);
		},
		update(host) {
			const hosts = load();
			const index = hosts.findIndex((h) => h.hostKey === host.hostKey);
			if (index < 0) return hosts;
			hosts[index] = host;
			return save(hosts);
		},
		remove(hostKey) {
			return save(load().filter((h) => h.hostKey !== hostKey));
		},
	};
}

/** The saved host with the routes its computer sent now; a route the computer dropped is dropped too. */
export function withRoutes(host: SavedHost, routes: RemoteHostRoutes): SavedHost {
	const next: SavedHost = {
		...host,
		relayUrl: routes.signalingUrls[0] ?? host.relayUrl,
		relayUrls: routes.signalingUrls,
	};
	if (routes.nostr) next.nostr = routes.nostr;
	else delete next.nostr;
	return next;
}
