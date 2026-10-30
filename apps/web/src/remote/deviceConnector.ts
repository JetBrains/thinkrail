import {
	type DeviceMessage,
	encodeBrokerFrame,
	encodeDeviceMessage,
	type HostMessage,
	parseBrokerMessage,
	parseHostMessage,
	parsePairingUri,
} from "@thinkrail/contracts";
import { toDeviceChannel } from "./deviceChannel";
import { createDeviceWireClient, type DeviceWireClient } from "./deviceWireClient";

export interface RemoteConnection {
	client: DeviceWireClient;
	hostKey: string;
	relayUrl: string;
	projectRef: string;
	close(): void;
}

const DEVICE_KEY_STORAGE = "thinkrail.remote.deviceKey";
const MAX_BACKOFF_MS = 10_000;

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
	relayUrl: string;
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
	const resumeFrame: DeviceMessage = { kind: "resume", devicePublicKey: key.publicKeyRaw };
	const firstFrame: DeviceMessage =
		params.token !== undefined
			? {
					kind: "hello",
					token: params.token,
					devicePublicKey: key.publicKeyRaw,
					label: params.label,
				}
			: resumeFrame;

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

	const sign = async (challenge: string): Promise<string> => {
		const signature = await crypto.subtle.sign(
			{ name: "Ed25519" },
			key.privateKey,
			base64urlToBytes(challenge),
		);
		return bytesToBase64url(new Uint8Array(signature));
	};

	const attempt = (initiate: DeviceMessage): Promise<void> =>
		new Promise<void>((resolve, reject) => {
			const ws = new WebSocket(params.relayUrl);
			const pc = new RTCPeerConnection();
			active = { ws, pc };
			let settled = false;

			const dropped = (reason: string): void => {
				if (settled) {
					if (!closed) scheduleReconnect();
				} else {
					settled = true;
					reject(new Error(reason));
				}
			};
			const send = (message: DeviceMessage): void =>
				ws.send(encodeBrokerFrame({ t: "frame", data: encodeDeviceMessage(message) }));

			pc.addEventListener("icecandidate", (event) => {
				if (event.candidate)
					send({ kind: "candidate", candidate: JSON.stringify(event.candidate.toJSON()) });
			});
			pc.addEventListener("connectionstatechange", () => {
				if (pc.connectionState === "failed" || pc.connectionState === "disconnected") {
					teardownActive();
					dropped("peer connection lost");
				}
			});
			pc.addEventListener("datachannel", (event) => {
				event.channel.addEventListener("open", () => {
					client.attach(toDeviceChannel(event.channel));
					settled = true;
					backoff = 500;
					resolve();
				});
			});

			const onHost = async (message: HostMessage): Promise<void> => {
				switch (message.kind) {
					case "challenge":
						send({ kind: "proof", signature: await sign(message.challenge) });
						return;
					case "rejected":
						dropped(message.reason);
						return;
					case "offer": {
						await pc.setRemoteDescription({ type: "offer", sdp: message.sdp });
						const answer = await pc.createAnswer();
						await pc.setLocalDescription(answer);
						if (answer.sdp) send({ kind: "answer", sdp: answer.sdp });
						return;
					}
					case "candidate":
						await pc.addIceCandidate(JSON.parse(message.candidate) as RTCIceCandidateInit);
						return;
					default:
						return;
				}
			};

			ws.addEventListener("open", () =>
				ws.send(encodeBrokerFrame({ t: "connect", hostKey: params.hostKey })),
			);
			ws.addEventListener("error", () => dropped("relay connection failed"));
			ws.addEventListener("close", () => dropped("relay connection closed"));
			ws.addEventListener("message", (event: MessageEvent) => {
				if (typeof event.data !== "string") return;
				const frame = parseBrokerMessage(event.data);
				if (!frame) return;
				if (frame.t === "error") return dropped(frame.reason);
				if (frame.t === "ready") return send(initiate);
				if (frame.t === "frame") {
					const host = parseHostMessage(frame.data);
					if (host) void onHost(host).catch((error: unknown) => dropped(String(error)));
				}
			});
		});

	const scheduleReconnect = (): void => {
		if (closed) return;
		const delay = backoff;
		backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
		setTimeout(() => {
			if (closed) return;
			attempt(resumeFrame).catch(() => scheduleReconnect());
		}, delay);
	};

	await attempt(firstFrame);

	return {
		client,
		hostKey: params.hostKey,
		relayUrl: params.relayUrl,
		projectRef: params.projectRef,
		close: () => {
			closed = true;
			teardownActive();
			client.close();
		},
	};
}

/** First pairing: parse a `thinkrail://pair` link and connect with its one-time token. */
export function connectRemoteProject(
	link: string,
	options: { label: string },
): Promise<RemoteConnection> {
	const pairing = parsePairingUri(link);
	if (!pairing) throw new Error("Invalid pairing link");
	return openRemote({
		relayUrl: pairing.signalingUrl,
		hostKey: pairing.hostPublicKey,
		projectRef: pairing.projectRef,
		token: pairing.token,
		label: options.label,
	});
}

/** Reconnect to an already-paired host (no token) — re-authorizes by the registered device key via `resume`. */
export function connectSavedHost(host: {
	relayUrl: string;
	hostKey: string;
	label: string;
}): Promise<RemoteConnection> {
	return openRemote({
		relayUrl: host.relayUrl,
		hostKey: host.hostKey,
		projectRef: "",
		label: host.label,
	});
}
