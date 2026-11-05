import {
	answerTranscript,
	type DeviceMessage,
	encodeBrokerFrame,
	encodeDeviceMessage,
	type HostMessage,
	offerTranscript,
	pairingMacInput,
	parseBrokerMessage,
	parseHostMessage,
	parsePairingUri,
	withPublicStun,
} from "@thinkrail/contracts";
import { brokerFailure, hostRejection, RemoteConnectError } from "./connectError";
import { toDeviceChannel } from "./deviceChannel";
import { createDeviceWireClient, type DeviceWireClient } from "./deviceWireClient";
import { openFirstRelay } from "./relayPicker";

export interface RemoteConnection {
	client: DeviceWireClient;
	hostKey: string;
	/** The relay address that answered first. */
	relayUrl: string;
	/** Every address the host advertised, kept so a later reconnect can take whichever route works then. */
	relayUrls: readonly string[];
	/** The computer's name from the pairing link, when it sent one. */
	hostName?: string;
	projectRef: string;
	close(): void;
}

const DEVICE_KEY_STORAGE = "thinkrail.remote.deviceKey";
const MAX_BACKOFF_MS = 10_000;
/**
 * How long one attempt may take from reaching the relay to an open data channel. Past it the attempt fails
 * instead of leaving the app on "Connecting…": as `host_silent` when the host never answered, else as
 * `no_direct_route` (signaling worked, WebRTC did not).
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
	let backoff = 500;
	let active: { ws: WebSocket; pc: RTCPeerConnection } | null = null;

	const teardownActive = (): void => {
		if (!active) return;
		try {
			active.ws.close();
		} catch {}
		try {
			active.pc.close();
		} catch {}
		active = null;
	};

	const sign = async (data: Uint8Array<ArrayBuffer>): Promise<string> => {
		const signature = await crypto.subtle.sign({ name: "Ed25519" }, key.privateKey, data);
		return bytesToBase64url(new Uint8Array(signature));
	};

	let relayUrl = params.relayUrls[0] ?? "";

	/** One connection attempt: `pairing` sends the QR token's `hello`, otherwise the device `resume`s. */
	const attempt = async (pairing: boolean): Promise<void> => {
		const nonce = randomToken();
		let challenge = "";
		const initiate: DeviceMessage =
			pairing && tokenId !== undefined
				? { kind: "hello", tokenId, devicePublicKey: key.publicKeyRaw, label: params.label, nonce }
				: { kind: "resume", devicePublicKey: key.publicKeyRaw, nonce };
		const picked = await openFirstRelay(params.relayUrls, (url) => new WebSocket(url));
		if (closed) {
			picked.socket.close();
			throw new Error("connection closed");
		}
		relayUrl = picked.url;
		const ws = picked.socket;
		return new Promise<void>((resolve, reject) => {
			const pc = new RTCPeerConnection({ iceServers: withPublicStun() });
			active = { ws, pc };
			let settled = false;
			let over = false;
			let heardHost = false;
			let signals: Promise<void> = Promise.resolve();

			const dropped = (error: RemoteConnectError): void => {
				if (over) return;
				over = true;
				clearTimeout(timer);
				teardownActive();
				if (settled) {
					if (!closed) scheduleReconnect();
				} else {
					reject(error);
				}
			};
			const timer = setTimeout(
				() =>
					dropped(
						heardHost
							? new RemoteConnectError(
									"no_direct_route",
									"the connection to the computer timed out",
								)
							: new RemoteConnectError("host_silent", "the computer did not answer"),
					),
				CONNECT_TIMEOUT_MS,
			);
			const send = (message: DeviceMessage): void =>
				ws.send(encodeBrokerFrame({ t: "frame", data: encodeDeviceMessage(message) }));

			pc.addEventListener("icecandidate", (event) => {
				if (event.candidate)
					send({ kind: "candidate", candidate: JSON.stringify(event.candidate.toJSON()) });
			});
			pc.addEventListener("connectionstatechange", () => {
				if (pc.connectionState === "failed" || pc.connectionState === "disconnected") {
					dropped(new RemoteConnectError("no_direct_route", "peer connection lost"));
				}
			});
			pc.addEventListener("datachannel", (event) => {
				event.channel.addEventListener("open", () => {
					client.attach(toDeviceChannel(event.channel));
					clearTimeout(timer);
					settled = true;
					backoff = 500;
					resolve();
				});
			});

			const onHost = async (message: HostMessage): Promise<void> => {
				heardHost = true;
				switch (message.kind) {
					case "challenge": {
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
						await pc.setRemoteDescription({ type: "offer", sdp: message.sdp });
						const answer = await pc.createAnswer();
						await pc.setLocalDescription(answer);
						if (answer.sdp) {
							const signature = await sign(answerTranscript(challenge, answer.sdp));
							send({ kind: "answer", sdp: answer.sdp, signature });
						}
						return;
					}
					case "candidate":
						await pc.addIceCandidate(JSON.parse(message.candidate) as RTCIceCandidateInit);
						return;
					default:
						return;
				}
			};

			ws.addEventListener("error", () =>
				dropped(new RemoteConnectError("relay_lost", "relay connection failed")),
			);
			ws.addEventListener("close", () =>
				dropped(new RemoteConnectError("relay_lost", "relay connection closed")),
			);
			ws.addEventListener("message", (event: MessageEvent) => {
				if (typeof event.data !== "string") return;
				const frame = parseBrokerMessage(event.data);
				if (!frame) return;
				if (frame.t === "error") return dropped(brokerFailure(frame.reason));
				if (frame.t === "ready") {
					if (frame.ice) pc.setConfiguration({ iceServers: withPublicStun(frame.ice) });
					return send(initiate);
				}
				if (frame.t === "frame") {
					const host = parseHostMessage(frame.data);
					if (host) {
						signals = signals
							.then(() => onHost(host))
							.catch((error: unknown) =>
								dropped(
									new RemoteConnectError(
										"failed",
										error instanceof Error ? error.message : String(error),
									),
								),
							);
					}
				}
			});
			ws.send(encodeBrokerFrame({ t: "connect", hostKey: params.hostKey }));
		});
	};

	const scheduleReconnect = (): void => {
		if (closed) return;
		const delay = backoff;
		backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
		setTimeout(() => {
			if (closed) return;
			attempt(false).catch(() => scheduleReconnect());
		}, delay);
	};

	await attempt(params.token !== undefined);

	return {
		client,
		hostKey: params.hostKey,
		relayUrl,
		relayUrls: params.relayUrls,
		projectRef: params.projectRef,
		close: () => {
			closed = true;
			teardownActive();
			client.close();
		},
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
	hostKey: string;
	label: string;
}): Promise<RemoteConnection> {
	return openRemote({
		relayUrls: host.relayUrls && host.relayUrls.length > 0 ? host.relayUrls : [host.relayUrl],
		hostKey: host.hostKey,
		projectRef: "",
		label: host.label,
	});
}
