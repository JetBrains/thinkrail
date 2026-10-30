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

/**
 * Opens (or re-opens) a remote session: connect to the relay, authorize (first time with the one-time pairing
 * token, reconnects with `resume` against the already-registered device key), negotiate a browser WebRTC
 * answer, and attach the opened channel to the wire client. A dropped connection auto-reconnects with backoff;
 * in-flight requests survive and replay (see `deviceWireClient`). Browser-only — uses the platform WebSocket,
 * RTCPeerConnection, and SubtleCrypto.
 */
export async function connectRemoteProject(
	link: string,
	options: { label: string },
): Promise<RemoteConnection> {
	const pairing = parsePairingUri(link);
	if (!pairing) throw new Error("Invalid pairing link");
	const key = await loadOrCreateDeviceKey();
	const client = createDeviceWireClient();

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

	/** Runs one connection attempt; resolves when its DataChannel opens, rejects on failure. */
	const attempt = (initiate: DeviceMessage): Promise<void> =>
		new Promise<void>((resolve, reject) => {
			const ws = new WebSocket(pairing.signalingUrl);
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
				ws.send(encodeBrokerFrame({ t: "connect", hostKey: pairing.hostPublicKey })),
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
			attempt({ kind: "resume", devicePublicKey: key.publicKeyRaw }).catch(() =>
				scheduleReconnect(),
			);
		}, delay);
	};

	await attempt({
		kind: "hello",
		token: pairing.token,
		devicePublicKey: key.publicKeyRaw,
		label: options.label,
	});

	return {
		client,
		projectRef: pairing.projectRef,
		close: () => {
			closed = true;
			teardownActive();
			client.close();
		},
	};
}
