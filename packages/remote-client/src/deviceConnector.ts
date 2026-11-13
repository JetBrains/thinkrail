import {
	answerTranscript,
	type DeviceMessage,
	encodeDeviceMessage,
	type HostMessage,
	type IceServer,
	offerTranscript,
	type PairingNostrRoute,
	pairingMacInput,
	parseHostMessage,
	parsePairingUri,
	parseRemoteHostRoutes,
	type RemoteHostRoutes,
	WS_CHANNELS,
	withPublicStun,
} from "@thinkrail/contracts";
import { hostRejection, isTerminalConnectError, RemoteConnectError } from "./connectError";
import { toDeviceChannel } from "./deviceChannel";
import { createDeviceWireClient, type DeviceWireClient } from "./deviceWireClient";
import type { KeyValueStore } from "./hostRegistry";
import { createReconnectLoop } from "./reconnectLoop";
import { RelayUnreachableError } from "./relayPicker";
import { openSignaling, type SignalingPipe } from "./signalingRoute";

/** What a connection reports, given when it is created so nothing it says is missed. */
export interface ConnectionEvents {
	/**
	 * Called once when the connection is gone for good: an attempt the host refused in a way retrying cannot fix
	 * (this phone was revoked, the host key changed, the app is too old). The connection is closed by then.
	 */
	onLost?: (error: RemoteConnectError) => void;
	/** Hears the channel open (the first time too) and go down while it comes back on its own. */
	onOpenChange?: (open: boolean) => void;
	/** Hears each failed attempt that will be retried, so the app can say why. */
	onRetryFailed?: (error: unknown) => void;
	/** Hears the host's current routes; later attempts already dial them. */
	onRoutes?: (routes: RemoteHostRoutes) => void;
}

export interface RemoteConnection {
	client: DeviceWireClient;
	hostKey: string;
	/** The relay address that answered last; empty when the host was reached over Nostr. */
	readonly relayUrl: string;
	/** Every address the host advertised, kept so a later reconnect can take whichever route works then. */
	relayUrls: readonly string[];
	/** The host's Nostr route from the pairing link, for a reconnect from any network. */
	nostr?: PairingNostrRoute;
	/** The computer's name from the pairing link, when it sent one. */
	hostName?: string;
	/** Attempts now instead of after the backoff (the app came to the foreground, the network changed). */
	reconnectNow(): void;
	close(): void;
}

const DEVICE_KEY_STORAGE = "thinkrail.remote.deviceKey";
/**
 * How long one attempt may take from its start to an open data channel. Past it the attempt fails instead of
 * leaving the app on "Connecting…": as `relay_unreachable` when no signaling route got ready, `host_silent`
 * when the host never answered, else as `no_direct_route` (signaling worked, WebRTC did not).
 */
export const CONNECT_TIMEOUT_MS = 20_000;

function base64urlToBytes(value: string): Uint8Array<ArrayBuffer> {
	const padded = value
		.replace(/-/g, "+")
		.replace(/_/g, "/")
		.padEnd(Math.ceil(value.length / 4) * 4, "=");
	const binary = atob(padded);
	const bytes = new Uint8Array(new ArrayBuffer(binary.length));
	for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
	return bytes;
}

function bytesToBase64url(bytes: Uint8Array): string {
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const encoder = new TextEncoder();

function utf8(value: string): Uint8Array<ArrayBuffer> {
	const bytes = encoder.encode(value);
	const out = new Uint8Array(new ArrayBuffer(bytes.length));
	out.set(bytes);
	return out;
}

function randomToken(): string {
	return bytesToBase64url(crypto.getRandomValues(new Uint8Array(32)));
}

/** `pairingTokenId`: the QR token's public name, so the relay-visible `hello` never carries the token. */
async function tokenIdOf(token: string): Promise<string> {
	return bytesToBase64url(new Uint8Array(await crypto.subtle.digest("SHA-256", utf8(token))));
}

async function pairingMac(
	token: string,
	devicePublicKey: string,
	challenge: string,
): Promise<string> {
	const key = await crypto.subtle.importKey(
		"raw",
		utf8(token),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	const mac = await crypto.subtle.sign("HMAC", key, pairingMacInput(devicePublicKey, challenge));
	return bytesToBase64url(new Uint8Array(mac));
}

/** True when the offer was signed by the host key the device paired with, so no relay spliced in its own. */
async function hostSigned(
	hostKey: string,
	nonce: string,
	challenge: string,
	message: { sdp: string; signature: string },
): Promise<boolean> {
	try {
		const key = await crypto.subtle.importKey(
			"raw",
			base64urlToBytes(hostKey),
			{ name: "Ed25519" },
			false,
			["verify"],
		);
		return await crypto.subtle.verify(
			{ name: "Ed25519" },
			key,
			base64urlToBytes(message.signature),
			offerTranscript(nonce, challenge, message.sdp),
		);
	} catch {
		return false;
	}
}

interface DeviceKey {
	privateKey: CryptoKey;
	publicKeyRaw: string;
}

/** The browser's own storage, where a device keeps its key unless its shell gives a steadier one. */
export const browserStore: KeyValueStore = {
	read: (key) => localStorage.getItem(key),
	write: (key, value) => localStorage.setItem(key, value),
};

/** A stable per-device Ed25519 identity, so a reconnect re-authorizes as the same (already-paired) device. */
async function loadOrCreateDeviceKey(store: KeyValueStore): Promise<DeviceKey> {
	const stored = store.read(DEVICE_KEY_STORAGE);
	if (stored) {
		try {
			const parsed = JSON.parse(stored) as { privateJwk: JsonWebKey; publicKeyRaw: string };
			const privateKey = await crypto.subtle.importKey(
				"jwk",
				parsed.privateJwk,
				{ name: "Ed25519" },
				true,
				["sign"],
			);
			return { privateKey, publicKeyRaw: parsed.publicKeyRaw };
		} catch {
			// fall through and regenerate
		}
	}
	const keyPair = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, [
		"sign",
		"verify",
	])) as CryptoKeyPair;
	const privateJwk = await crypto.subtle.exportKey("jwk", keyPair.privateKey);
	const publicKeyRaw = (await crypto.subtle.exportKey("jwk", keyPair.publicKey)).x;
	if (!publicKeyRaw) throw new Error("could not derive the device key");
	store.write(DEVICE_KEY_STORAGE, JSON.stringify({ privateJwk, publicKeyRaw }));
	return { privateKey: keyPair.privateKey, publicKeyRaw };
}

interface OpenParams {
	relayUrls: readonly string[];
	nostr?: PairingNostrRoute | undefined;
	hostKey: string;
	hostName?: string | undefined;
	/** The one-time pairing token for a first pairing; omitted when resuming an already-paired host. */
	token?: string;
	label: string;
	events: ConnectionEvents;
	/** Where the device key lives. */
	keyStore: KeyValueStore;
}

/**
 * Creates a remote connection and starts its first attempt at once. A saved host `resume`s and re-authorizes by
 * the registered device key, and the reconnect loop owns every attempt, the first included; a first pairing
 * sends `hello` + the one-time token once, and `paired` rejects (the connection closed) when that fails. Each
 * attempt negotiates a browser WebRTC answer and attaches the opened channel to the wire client; in-flight
 * requests survive a drop and replay. Browser-only (WebSocket, RTCPeerConnection, SubtleCrypto).
 */
function openRemote(params: OpenParams): { connection: RemoteConnection; paired: Promise<void> } {
	const { events } = params;
	const keyReady = loadOrCreateDeviceKey(params.keyStore);
	const tokenIdReady = params.token !== undefined ? tokenIdOf(params.token) : undefined;
	const client = createDeviceWireClient();

	let closed = false;
	let routes: { relayUrls: readonly string[]; nostr: PairingNostrRoute | undefined } = {
		relayUrls: params.relayUrls,
		nostr: params.nostr,
	};
	client.subscribe(WS_CHANNELS.remoteHostRoutes, (data) => {
		const next = parseRemoteHostRoutes(data);
		if (!next) return;
		routes = { relayUrls: next.signalingUrls, nostr: next.nostr };
		events.onRoutes?.(next);
	});
	/** The attempt in flight or live: `abort` ends it, `probe` drops a live one whose peer or channel is dead. */
	let current: { abort(): void; probe(): void } | null = null;

	let relayUrl = params.relayUrls[0] ?? "";

	/** One connection attempt: `pairing` sends the QR token's `hello`, otherwise the device `resume`s. */
	const attempt = async (pairing: boolean): Promise<void> => {
		const key = await keyReady;
		const tokenId = pairing ? await tokenIdReady : undefined;
		if (closed) throw new RemoteConnectError("failed", "the connection was closed");
		const sign = async (data: Uint8Array<ArrayBuffer>): Promise<string> => {
			const signature = await crypto.subtle.sign({ name: "Ed25519" }, key.privateKey, data);
			return bytesToBase64url(new Uint8Array(signature));
		};
		return new Promise<void>((resolve, reject) => {
			const nonce = randomToken();
			let challenge = "";
			const initiate: DeviceMessage =
				tokenId !== undefined
					? {
							kind: "hello",
							tokenId,
							devicePublicKey: key.publicKeyRaw,
							label: params.label,
							nonce,
						}
					: { kind: "resume", devicePublicKey: key.publicKeyRaw, nonce };
			let pipe: SignalingPipe | null = null;
			let pc: RTCPeerConnection | null = null;
			let channel: RTCDataChannel | null = null;
			let settled = false;
			let over = false;
			let heardHost = false;
			let signals: Promise<void> = Promise.resolve();

			const dropped = (error: unknown): void => {
				if (over) return;
				over = true;
				clearTimeout(timer);
				if (current === handle) current = null;
				try {
					pipe?.close();
				} catch {}
				try {
					pc?.close();
				} catch {}
				if (settled) {
					if (!closed) loop.dropped();
				} else {
					reject(error);
				}
			};
			const handle = {
				abort: () => dropped(new RemoteConnectError("failed", "the connection was closed")),
				probe: () => {
					const peerState = pc?.connectionState;
					const peerDead = peerState !== undefined && peerState !== "connected";
					if (settled && (peerDead || channel?.readyState !== "open"))
						dropped(new RemoteConnectError("relay_lost", "the connection went quiet"));
				},
			};
			current = handle;
			const timer = setTimeout(
				() =>
					dropped(
						pipe === null
							? new RelayUnreachableError([...routes.relayUrls, ...(routes.nostr?.relays ?? [])])
							: heardHost
								? new RemoteConnectError(
										"no_direct_route",
										"the connection to the computer timed out",
									)
								: new RemoteConnectError("host_silent", "the computer did not answer"),
					),
				CONNECT_TIMEOUT_MS,
			);

			const start = (opened: SignalingPipe, ice: readonly IceServer[] | undefined): void => {
				if (over) {
					opened.close();
					return;
				}
				pipe = opened;
				relayUrl = opened.route === "relay" ? opened.url : "";
				const peer = new RTCPeerConnection({
					iceServers: withPublicStun(ice ? [...ice] : undefined),
				});
				pc = peer;
				const send = (message: DeviceMessage): void => opened.send(encodeDeviceMessage(message));

				peer.addEventListener("icecandidate", (event) => {
					if (event.candidate && !over)
						send({ kind: "candidate", candidate: JSON.stringify(event.candidate.toJSON()) });
				});
				peer.addEventListener("connectionstatechange", () => {
					if (peer.connectionState === "failed" || peer.connectionState === "disconnected") {
						dropped(new RemoteConnectError("no_direct_route", "peer connection lost"));
					}
				});
				peer.addEventListener("datachannel", (event) => {
					const opening = event.channel;
					opening.addEventListener("close", () =>
						dropped(new RemoteConnectError("relay_lost", "the computer closed the connection")),
					);
					opening.addEventListener("open", () => {
						if (over || settled) {
							opening.close();
							return;
						}
						channel = opening;
						client.attach(toDeviceChannel(opening));
						clearTimeout(timer);
						settled = true;
						if (opened.route === "nostr") opened.close();
						resolve();
					});
				});

				const onHost = async (message: HostMessage): Promise<void> => {
					if (over || settled) return;
					heardHost = true;
					switch (message.kind) {
						case "challenge": {
							if (challenge) return;
							challenge = message.challenge;
							const signature = await sign(base64urlToBytes(challenge));
							send(
								tokenId !== undefined && params.token !== undefined
									? {
											kind: "proof",
											signature,
											mac: await pairingMac(params.token, key.publicKeyRaw, challenge),
										}
									: { kind: "proof", signature },
							);
							return;
						}
						case "rejected":
							dropped(hostRejection(message.reason, message.code));
							return;
						case "offer": {
							if (!challenge || !(await hostSigned(params.hostKey, nonce, challenge, message))) {
								dropped(new RemoteConnectError("identity_mismatch", "host identity check failed"));
								return;
							}
							await peer.setRemoteDescription({ type: "offer", sdp: message.sdp });
							const answer = await peer.createAnswer();
							await peer.setLocalDescription(answer);
							if (answer.sdp && !over) {
								const signature = await sign(answerTranscript(challenge, answer.sdp));
								send({ kind: "answer", sdp: answer.sdp, signature });
							}
							return;
						}
						case "candidate":
							await peer.addIceCandidate(JSON.parse(message.candidate) as RTCIceCandidateInit);
							return;
						default:
							return;
					}
				};

				opened.listen(
					(data) => {
						const host = parseHostMessage(data);
						if (!host) return;
						signals = signals
							.then(() => onHost(host))
							.catch((error: unknown) => {
								if (!settled)
									dropped(
										new RemoteConnectError(
											"failed",
											error instanceof Error ? error.message : String(error),
										),
									);
							});
					},
					(error) => {
						if (!settled) dropped(error);
					},
				);
				send(initiate);
			};

			openSignaling(routes.relayUrls, params.hostKey, routes.nostr)
				.then(({ pipe: opened, ice }) => start(opened, ice))
				.catch(dropped);
		});
	};

	const shutDown = (): void => {
		closed = true;
		loop.stop();
		current?.abort();
		client.close();
	};
	const loop = createReconnectLoop({
		attempt: () => attempt(false),
		isTerminal: isTerminalConnectError,
		onLost: (error) => {
			if (closed) return;
			shutDown();
			events.onLost?.(
				error instanceof RemoteConnectError
					? error
					: new RemoteConnectError("failed", String(error)),
			);
		},
		...(events.onOpenChange ? { onOpenChange: events.onOpenChange } : {}),
		...(events.onRetryFailed ? { onRetryFailed: events.onRetryFailed } : {}),
	});

	const connection: RemoteConnection = {
		client,
		hostKey: params.hostKey,
		get relayUrl() {
			return relayUrl;
		},
		relayUrls: params.relayUrls,
		...(params.nostr ? { nostr: params.nostr } : {}),
		...(params.hostName ? { hostName: params.hostName } : {}),
		reconnectNow: () => {
			current?.probe();
			loop.now();
		},
		close: shutDown,
	};
	if (params.token === undefined) {
		loop.now();
		return { connection, paired: Promise.resolve() };
	}
	const paired = attempt(true).then(
		() => loop.opened(),
		(error: unknown) => {
			shutDown();
			throw error;
		},
	);
	return { connection, paired };
}

/**
 * First pairing: parse a `thinkrail://pair` link and connect with its one-time token. Rejects when that first
 * attempt fails (a bad or expired code is reported, not retried); afterwards the connection reconnects itself.
 */
export async function connectRemoteProject(
	link: string,
	options: { label: string; keyStore?: KeyValueStore } & ConnectionEvents,
): Promise<RemoteConnection> {
	const pairing = parsePairingUri(link);
	if (!pairing) throw new RemoteConnectError("invalid_link", "Invalid pairing link");
	const { label, keyStore = browserStore, ...events } = options;
	const { connection, paired } = openRemote({
		relayUrls: pairing.signalingUrls,
		nostr: pairing.nostr,
		hostKey: pairing.hostPublicKey,
		hostName: pairing.hostName,
		token: pairing.token,
		label,
		events,
		keyStore,
	});
	await paired;
	return connection;
}

/**
 * Connects an already-paired host (no token), re-authorizing by the registered device key via `resume`. Returns
 * at once: every attempt, the first included, is the reconnect loop's, so a host that cannot be reached yet is
 * retried (`onRetryFailed`) until it opens (`onOpenChange`) or is refused for good (`onLost`).
 */
export function connectSavedHost(
	host: {
		relayUrl: string;
		relayUrls?: readonly string[] | undefined;
		nostr?: PairingNostrRoute | undefined;
		hostKey: string;
		label: string;
	},
	events: ConnectionEvents = {},
	keyStore: KeyValueStore = browserStore,
): RemoteConnection {
	const relayUrls =
		host.relayUrls && host.relayUrls.length > 0
			? host.relayUrls
			: host.relayUrl
				? [host.relayUrl]
				: [];
	return openRemote({
		relayUrls,
		nostr: host.nostr,
		hostKey: host.hostKey,
		label: host.label,
		events,
		keyStore,
	}).connection;
}
