import {
	addDevice,
	buildPairingUri,
	createPairingTokens,
	findDeviceByKey,
	type HostIdentity,
	loadOrCreateIdentity,
	newChallenge,
	type PairedDevice,
	verifyPairingMac,
	verifyPairingProof,
	verifySignature,
} from "../remote";
import type { RemoteChannel } from "./channel";
import { type BrokerConnection, connectHostBroker, type HostBrokerDeps } from "./hostBrokerClient";
import { createWeriftHostPeer } from "./hostPeer";
import { createHostSession } from "./hostSession";
import type { RelayAddress } from "./localRelay";
import {
	connectNostrHost,
	type NostrHostConnection,
	type NostrHostOptions,
} from "./nostrHostSignaling";
import { createHostHandshake } from "./signalingSession";

export interface RemoteAccess {
	readonly identity: HostIdentity;
	/** The relay addresses every pairing link carries, in the order the device should prefer them. */
	readonly addresses: readonly RelayAddress[];
	/** The Nostr route phones on any network signal through, and how many of its relays are live; null when off. */
	readonly nostr: { relays: readonly string[]; connected: number } | null;
	/** Mints a one-time pairing link (the `thinkrail://pair` URI) for a project, with when it expires. */
	issueLink(projectRef: string): PairingLink;
	stop(): void;
}

export interface PairingLink {
	link: string;
	expiresAt: number;
}

export interface RemoteAccessOptions {
	/** The signaling broker (relay) URL the host connects to. */
	relayUrl: string;
	/** The addresses a device reaches that relay at, read per link; defaults to `relayUrl` itself. */
	advertised?: () => readonly RelayAddress[];
	/** The computer's name, shown on the paired device. */
	hostName?: string;
	identity?: HostIdentity;
	onPaired?: (device: PairedDevice, channel: RemoteChannel) => void;
	/** Broker connector; defaults to a real WebSocket. Injected in tests. */
	connect?: (url: string, deps: HostBrokerDeps) => BrokerConnection;
	/** Public Nostr relays to also listen on, so a phone on any network can reach this host; none turns it off. */
	nostrRelays?: readonly string[];
	/** Nostr connector; injected in tests. */
	connectNostr?: (options: NostrHostOptions) => NostrHostConnection;
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
	const configured: readonly RelayAddress[] = [{ url: options.relayUrl, route: "relay" }];
	const advertised = options.advertised ?? (() => configured);

	const openSession: HostBrokerDeps["openSession"] = (_sessionId, toDevice) => {
		const handshake = createHostHandshake({
			newChallenge,
			consumeToken: (tokenId) => tokens.consume(tokenId),
			verifyProof: verifyPairingProof,
			verifyMac: verifyPairingMac,
			registerDevice: (device) => void addDevice(device),
			findDevice: (key) => findDeviceByKey(key),
		});
		const peer = createWeriftHostPeer();
		const session = createHostSession({
			handshake,
			peer,
			send: toDevice,
			sign: identity.sign,
			verify: verifySignature,
		});
		session.onChannel((channel, device) => options.onPaired?.(device, channel));
		return session;
	};
	const client = connect(options.relayUrl, {
		hostKey: identity.publicKey,
		sign: identity.sign,
		openSession,
	});
	const nostr =
		options.nostrRelays && options.nostrRelays.length > 0
			? (options.connectNostr ?? connectNostrHost)({
					secretKey: identity.nostrSecret,
					relays: options.nostrRelays,
					openSession,
				})
			: null;

	return {
		identity,
		get addresses() {
			return advertised();
		},
		get nostr() {
			return nostr ? { relays: nostr.relays, connected: nostr.connectedRelays() } : null;
		},
		issueLink(projectRef) {
			const { token, expiresAt } = tokens.issue(projectRef);
			const link = buildPairingUri({
				signalingUrls: advertised().map((address) => address.url),
				token,
				hostPublicKey: identity.publicKey,
				projectRef,
				...(options.hostName ? { hostName: options.hostName } : {}),
				...(nostr && nostr.relays.length > 0
					? { nostr: { publicKey: nostr.publicKey, relays: nostr.relays } }
					: {}),
			});
			return { link, expiresAt };
		},
		stop: () => {
			client.stop();
			nostr?.stop();
		},
	};
}
