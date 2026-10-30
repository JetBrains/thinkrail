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

/**
 * The device side of "open a project by link": parse the link, connect to the relay, run the pairing
 * handshake (Ed25519 via `crypto.subtle`), negotiate a browser WebRTC answer, and hand the opened DataChannel
 * to the wire client. Resolves once the channel is open. Browser-only — it uses the platform's WebSocket,
 * RTCPeerConnection, and SubtleCrypto; there is no library to bundle.
 */
export async function connectRemoteProject(
	link: string,
	options: { label: string },
): Promise<RemoteConnection> {
	const pairing = parsePairingUri(link);
	if (!pairing) throw new Error("Invalid pairing link");

	const keyPair = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, [
		"sign",
		"verify",
	])) as CryptoKeyPair;
	const devicePublicKey = (await crypto.subtle.exportKey("jwk", keyPair.publicKey)).x;
	if (!devicePublicKey) throw new Error("could not derive the device key");

	const ws = new WebSocket(pairing.signalingUrl);
	const pc = new RTCPeerConnection();

	const teardown = (): void => {
		try {
			ws.close();
		} catch {}
		try {
			pc.close();
		} catch {}
	};
	const sendSignal = (message: DeviceMessage): void =>
		ws.send(encodeBrokerFrame({ t: "frame", data: encodeDeviceMessage(message) }));

	pc.addEventListener("icecandidate", (event) => {
		if (event.candidate) {
			sendSignal({ kind: "candidate", candidate: JSON.stringify(event.candidate.toJSON()) });
		}
	});

	return await new Promise<RemoteConnection>((resolve, reject) => {
		const fail = (reason: string): void => {
			teardown();
			reject(new Error(reason));
		};

		pc.addEventListener("datachannel", (event) => {
			const channel = event.channel;
			channel.addEventListener("open", () =>
				resolve({
					client: createDeviceWireClient(toDeviceChannel(channel)),
					projectRef: pairing.projectRef,
					close: teardown,
				}),
			);
		});

		const onHost = async (message: HostMessage): Promise<void> => {
			switch (message.kind) {
				case "challenge": {
					const signature = await crypto.subtle.sign(
						{ name: "Ed25519" },
						keyPair.privateKey,
						base64urlToBytes(message.challenge),
					);
					sendSignal({ kind: "proof", signature: bytesToBase64url(new Uint8Array(signature)) });
					return;
				}
				case "accepted":
					return;
				case "rejected":
					fail(message.reason);
					return;
				case "offer": {
					await pc.setRemoteDescription({ type: "offer", sdp: message.sdp });
					const answer = await pc.createAnswer();
					await pc.setLocalDescription(answer);
					if (answer.sdp) sendSignal({ kind: "answer", sdp: answer.sdp });
					return;
				}
				case "candidate":
					await pc.addIceCandidate(JSON.parse(message.candidate) as RTCIceCandidateInit);
					return;
			}
		};

		ws.addEventListener("open", () =>
			ws.send(encodeBrokerFrame({ t: "connect", hostKey: pairing.hostPublicKey })),
		);
		ws.addEventListener("error", () => fail("relay connection failed"));
		ws.addEventListener("message", (event: MessageEvent) => {
			if (typeof event.data !== "string") return;
			const frame = parseBrokerMessage(event.data);
			if (!frame) return;
			if (frame.t === "error") return fail(frame.reason);
			if (frame.t === "close") return fail("the host closed the connection");
			if (frame.t === "ready") {
				sendSignal({ kind: "hello", token: pairing.token, devicePublicKey, label: options.label });
				return;
			}
			if (frame.t === "frame") {
				const host = parseHostMessage(frame.data);
				if (host) void onHost(host).catch((error: unknown) => fail(String(error)));
			}
		});
	});
}
