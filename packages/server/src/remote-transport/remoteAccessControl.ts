import type { RemoteRelay } from "@thinkrail/contracts";
import {
	loadDevices,
	loadRemoteAccessEnabled,
	type PairedDevice,
	revokeDevice,
	saveRemoteAccessEnabled,
} from "../remote";
import type { RemoteChannel } from "./channel";
import { type LocalRelay, type RelayAddress, startLocalRelay } from "./localRelay";
import {
	type PairingLink,
	type RemoteAccess,
	type RemoteAccessOptions,
	startRemoteAccess,
} from "./remoteAccess";

export interface RemoteAccessState {
	enabled: boolean;
	/** Where a phone can reach this host while access is on; empty when off or when no network is up. */
	addresses: readonly RelayAddress[];
	devices: readonly (PairedDevice & { connected: boolean })[];
	/** Absent while access is off. */
	relay?: RemoteRelay;
}

export interface RemoteAccessControlOptions {
	/** A configured relay (`--relay`); without one the host runs its own on this machine. */
	relayUrl?: string;
	hostName?: string;
	onPaired: (device: PairedDevice, channel: RemoteChannel) => void;
	/** Where the setting and device registry live; the host data dir by default. Injected in tests. */
	dataDir?: string;
	startLocal?: () => LocalRelay;
	startAccess?: (options: RemoteAccessOptions) => RemoteAccess;
}

export interface RemoteAccessControl {
	state(): RemoteAccessState;
	/**
	 * Turns phone access on or off now. `persist` (the default) records the choice so the host comes back up
	 * the same way; a one-run launch flag (`--remote`) passes false.
	 */
	setEnabled(enabled: boolean, options?: { persist?: boolean }): RemoteAccessState;
	/** Settles once the addresses a phone can reach are known (the public one is looked up after start). */
	ready(): Promise<void>;
	/** Mints a one-time pairing link; throws while access is off. */
	issueLink(projectRef: string): PairingLink;
	revokeDevice(deviceId: string): RemoteAccessState;
	/** Brings access back up at startup when the user left it on. */
	restore(): RemoteAccessState;
	stop(): void;
}

/**
 * Owns the lifecycle of remote access so it can be switched at runtime from Settings rather than only by a
 * launch flag: starting brings up the relay (the host's own unless one is configured) and the broker
 * connection, stopping tears both down, which closes every live device channel with them.
 */
export function createRemoteAccessControl(
	options: RemoteAccessControlOptions,
): RemoteAccessControl {
	const startLocal = options.startLocal ?? startLocalRelay;
	const startAccess = options.startAccess ?? startRemoteAccess;
	let running: { access: RemoteAccess; relay: LocalRelay | null } | null = null;
	const channels = new Map<string, Set<RemoteChannel>>();

	const track = (device: PairedDevice, channel: RemoteChannel): void => {
		const open = channels.get(device.id) ?? new Set<RemoteChannel>();
		open.add(channel);
		channels.set(device.id, open);
		channel.onClose(() => {
			open.delete(channel);
			if (open.size === 0 && channels.get(device.id) === open) channels.delete(device.id);
		});
		options.onPaired(device, channel);
	};

	const start = (): void => {
		if (running) return;
		const relay = options.relayUrl === undefined ? startLocal() : null;
		try {
			const access = startAccess({
				relayUrl: relay ? relay.connectUrl : (options.relayUrl ?? ""),
				...(relay ? { advertised: () => relay.addresses } : {}),
				...(options.hostName ? { hostName: options.hostName } : {}),
				onPaired: track,
			});
			running = { access, relay };
		} catch (error) {
			relay?.stop();
			throw error;
		}
	};

	const halt = (): void => {
		if (!running) return;
		running.access.stop();
		running.relay?.stop();
		running = null;
	};

	const relayOf = (current: NonNullable<typeof running>): RemoteRelay =>
		current.relay
			? { kind: "builtIn", port: current.relay.port, publicCheck: current.relay.publicCheck }
			: { kind: "external", url: options.relayUrl ?? "" };

	const state = (): RemoteAccessState => ({
		enabled: running !== null,
		addresses: running ? running.access.addresses : [],
		devices: loadDevices(options.dataDir).map((device) => ({
			...device,
			connected: channels.has(device.id),
		})),
		...(running ? { relay: relayOf(running) } : {}),
	});

	return {
		state,
		setEnabled(enabled, { persist = true } = {}) {
			if (enabled) start();
			else halt();
			if (persist) saveRemoteAccessEnabled(enabled, options.dataDir);
			return state();
		},
		ready: () => running?.relay?.ready ?? Promise.resolve(),
		issueLink(projectRef) {
			if (!running) throw new Error("Phone access is off.");
			return running.access.issueLink(projectRef);
		},
		revokeDevice(deviceId) {
			revokeDevice(deviceId, options.dataDir);
			// The registry alone only stops the next resume; a live connection must close too.
			for (const channel of channels.get(deviceId) ?? []) channel.close();
			channels.delete(deviceId);
			return state();
		},
		restore() {
			if (loadRemoteAccessEnabled(options.dataDir)) start();
			return state();
		},
		stop: halt,
	};
}
