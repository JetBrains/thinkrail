import {
	addDevice,
	buildPairingUri,
	createPairingTokens,
	findDeviceByKey,
	type HostIdentity,
	loadOrCreateIdentity,
	newChallenge,
	type PairedDevice,
	verifyPairingProof,
} from "../remote";
import type { RemoteChannel } from "./channel";
import { connectHostBroker, type HostBrokerClient, type HostBrokerDeps } from "./hostBrokerClient";
import { createWeriftHostPeer } from "./hostPeer";
import { createHostSession } from "./hostSession";
import type { RelayAddress } from "./localRelay";
import { createHostHandshake } from "./signalingSession";

export interface RemoteAccess {
	readonly identity: HostIdentity;
	/** The relay addresses every pairing link carries, in the order the device should prefer them. */
	readonly addresses: readonly RelayAddress[];
	/** Mints a one-time pairing link (the `thinkrail://pair` URI) for a project. */
	issueLink(projectRef: string): string;
	stop(): void;
}

export interface RemoteAccessOptions {
	/** The signaling broker (relay) URL the host connects to. */
	relayUrl: string;
	/** The addresses a device reaches that relay at, put in the link; defaults to `relayUrl` itself. */
	advertised?: readonly RelayAddress[];
	/** The computer's name, shown on the paired device. */
	hostName?: string;
	identity?: HostIdentity;
	onPaired?: (device: PairedDevice, channel: RemoteChannel) => void;
	/** Broker connector; defaults to a real WebSocket. Injected in tests. */
	connect?: (url: string, deps: Omit<HostBrokerDeps, "socket">) => HostBrokerClient;
}

/**
 * Composition root for host-side remote access: loads the host identity, connects out to the broker, and for
 * each brokered device runs the pairing handshake and WebRTC negotiation. `issueLink` mints the one-time
 * pairing link to share. Wiring the opened `RemoteChannel` to the host wire protocol is a later slice; until
 * then `onPaired` surfaces the connection.
 */
export function startRemoteAccess(options: RemoteAccessOptions): RemoteAccess {
	const identity = options.identity ?? loadOrCreateIdentity();
	const tokens = createPairingTokens();
	const connect = options.connect ?? connectHostBroker;
	const addresses: readonly RelayAddress[] = options.advertised ?? [
		{ url: options.relayUrl, route: "relay" },
	];

	const client = connect(options.relayUrl, {
		hostKey: identity.publicKey,
		openSession: (_sessionId, toDevice) => {
			const handshake = createHostHandshake({
				newChallenge,
				consumeToken: (token) => tokens.consume(token),
				verifyProof: verifyPairingProof,
				registerDevice: (device) => void addDevice(device),
				findDevice: (key) => findDeviceByKey(key),
			});
			const peer = createWeriftHostPeer();
			const session = createHostSession({ handshake, peer, send: toDevice });
			session.onChannel((channel, device) => options.onPaired?.(device, channel));
			return session;
		},
	});

	return {
		identity,
		addresses,
		issueLink(projectRef) {
			const { token } = tokens.issue(projectRef);
			return buildPairingUri({
				signalingUrls: addresses.map((address) => address.url),
				token,
				hostPublicKey: identity.publicKey,
				projectRef,
				...(options.hostName ? { hostName: options.hostName } : {}),
			});
		},
		stop: () => client.stop(),
	};
}
