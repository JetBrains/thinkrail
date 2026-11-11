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
import { createReconnectLoop } from "./reconnectLoop";
import { RelayUnreachableError } from "./relayPicker";
import { openSignaling, type SignalingPipe } from "./signalingRoute";

export interface RemoteConnection {
	client: DeviceWireClient;
	hostKey: string;
	/** The relay address that answered first; empty when the host was reached over Nostr. */
	relayUrl: string;
	/** Every address the host advertised, kept so a later reconnect can take whichever route works then. */
	relayUrls: readonly string[];
	/** The host's Nostr route from the pairing link, for a reconnect from any network. */
	nostr?: PairingNostrRoute;
	/** The computer's name from the pairing link, when it sent one. */
	hostName?: string;
	projectRef: string;
	/**
	 * Called once when the connection is gone for good: a reconnect the host refused in a way retrying cannot
	 * fix (this phone was revoked, the host key changed, the app is too old). The connection is closed by then.
	 */
	onLost(handler: (error: RemoteConnectError) => void): void;
	/** Hears the channel go down (reconnecting on its own) and come back. */
	onOpenChange(handler: (open: boolean) => void): void;
	/** Hears each failed reconnect attempt while the channel is down, so the app can say why. */
	onRetryFailed(handler: (error: unknown) => void): void;
	/** Hears the host's current routes (the last one at once, if it came first); later reconnects already use them. */
	onRoutes(handler: (routes: RemoteHostRoutes) => void): void;
	/** Retries now instead of after the backoff (the app came to the foreground, the network changed). */
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

/** A stable per-browser Ed25519 identity, so a reconnect re-authorizes as the same (already-paired) device. */
async function loadOrCreateDeviceKey(): Promise<DeviceKey> {
	const stored = localStorage.getItem(DEVICE_KEY_STORAGE);
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
	localStorage.setItem(DEVICE_KEY_STORAGE, JSON.stringify({ privateJwk, publicKeyRaw }));
	return { privateKey: keyPair.privateKey, publicKeyRaw };
}

interface OpenParams {
	relayUrls: readonly string[];
	nostr?: PairingNostrRoute | undefined;
	hostKey: string;
	projectRef: string;
	/** The one-time pairing token for a first pairing; omitted when resuming an already-paired host. */
	token?: string;
	label: string;
}

/**
 * Opens (or re-opens) a remote session. A first pairing sends `hello` + the one-time token; a saved host (or a
 * reconnect) sends `resume` and re-authorizes by the registered device key. Negotiates a browser WebRTC answer
 * and attaches the opened channel to the wire client; a dropped connection auto-reconnects with backoff, and
 * in-flight requests survive and replay. Browser-only (WebSocket, RTCPeerConnection, SubtleCrypto).
 */
async function openRemote(params: OpenParams): Promise<RemoteConnection> {
	const key = await loadOrCreateDeviceKey();
	const client = createDeviceWireClient();
	const tokenId = params.token !== undefined ? await tokenIdOf(params.token) : undefined;

	let closed = false;
	let routes: { relayUrls: readonly string[]; nostr: PairingNostrRoute | undefined } = {
		relayUrls: params.relayUrls,
		nostr: params.nostr,
	};
	let routesHandler: (next: RemoteHostRoutes) => void = () => {};
	let lastRoutes: RemoteHostRoutes | null = null;
	client.subscribe(WS_CHANNELS.remoteHostRoutes, (data) => {
		const next = parseRemoteHostRoutes(data);
		if (!next) return;
		routes = { relayUrls: next.signalingUrls, nostr: next.nostr };
		lastRoutes = next;
		routesHandler(next);
	});
	/** The attempt in flight or live: `abort` ends it, `probe` drops a live one whose peer or channel is dead. */
	let current: { abort(): void; probe(): void } | null = null;

	const sign = async (data: Uint8Array<ArrayBuffer>): Promise<string> => {
		const signature = await crypto.subtle.sign({ name: "Ed25519" }, key.privateKey, data);
		return bytesToBase64url(new Uint8Array(signature));
	};

	let relayUrl = params.relayUrls[0] ?? "";

	/** One connection attempt: `pairing` sends the QR token's `hello`, otherwise the device `resume`s. */
	const attempt = (pairing: boolean): Promise<void> =>
		new Promise<void>((resolve, reject) => {
			const nonce = randomToken();
			let challenge = "";
			const initiate: DeviceMessage =
				pairing && tokenId !== undefined
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
								pairing && params.token !== undefined
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

	let lostHandler: (error: RemoteConnectError) => void = () => {};
	const shutDown = (): void => {
		closed = true;
		loop.stop();
		current?.abort();
		client.close();
	};
	const lose = (error: RemoteConnectError): void => {
		if (closed) return;
		shutDown();
		lostHandler(error);
	};

	let openHandler: (open: boolean) => void = () => {};
	let retryHandler: (error: unknown) => void = () => {};
	const loop = createReconnectLoop({
		attempt: () => attempt(false),
		isTerminal: isTerminalConnectError,
		onLost: (error) =>
			lose(
				error instanceof RemoteConnectError
					? error
					: new RemoteConnectError("failed", String(error)),
			),
		onOpenChange: (open) => openHandler(open),
		onRetryFailed: (error) => retryHandler(error),
	});

	try {
		await attempt(params.token !== undefined);
	} catch (error) {
		closed = true;
		client.close();
		throw error;
	}
	loop.opened();

	return {
		client,
		hostKey: params.hostKey,
		relayUrl,
		relayUrls: params.relayUrls,
		...(params.nostr ? { nostr: params.nostr } : {}),
		projectRef: params.projectRef,
		onLost: (handler) => {
			lostHandler = handler;
		},
		onOpenChange: (handler) => {
			openHandler = handler;
		},
		onRetryFailed: (handler) => {
			retryHandler = handler;
		},
		onRoutes: (handler) => {
			routesHandler = handler;
			if (lastRoutes) handler(lastRoutes);
		},
		reconnectNow: () => {
			current?.probe();
			loop.now();
		},
		close: shutDown,
	};
}

/** First pairing: parse a `thinkrail://pair` link and connect with its one-time token. */
export async function connectRemoteProject(
	link: string,
	options: { label: string },
): Promise<RemoteConnection> {
	const pairing = parsePairingUri(link);
	if (!pairing) throw new RemoteConnectError("invalid_link", "Invalid pairing link");
	const connection = await openRemote({
		relayUrls: pairing.signalingUrls,
		nostr: pairing.nostr,
		hostKey: pairing.hostPublicKey,
		projectRef: pairing.projectRef,
		token: pairing.token,
		label: options.label,
	});
	return pairing.hostName ? { ...connection, hostName: pairing.hostName } : connection;
}

/** Reconnect to an already-paired host (no token) — re-authorizes by the registered device key via `resume`. */
export function connectSavedHost(host: {
	relayUrl: string;
	relayUrls?: readonly string[] | undefined;
	nostr?: PairingNostrRoute | undefined;
	hostKey: string;
	label: string;
}): Promise<RemoteConnection> {
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
		projectRef: "",
		label: host.label,
	});
}
