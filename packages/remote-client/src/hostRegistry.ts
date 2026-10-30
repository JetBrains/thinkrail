export interface SavedHost {
	hostKey: string;
	relayUrl: string;
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
		remove(hostKey) {
			return save(load().filter((h) => h.hostKey !== hostKey));
		},
	};
}
