import { expect, test } from "bun:test";
import { sign as edSign, generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RTCPeerConnection } from "werift";
import {
	addDevice,
	createPairingTokens,
	loadDevices,
	newChallenge,
	verifyPairingProof,
} from "../remote";
import type { RemoteChannel } from "./channel";
import { createWeriftHostPeer } from "./hostPeer";
import { createHostSession } from "./hostSession";
import type { HostMessage } from "./signalingProtocol";
import { createHostHandshake } from "./signalingSession";
import { toRemoteChannel } from "./weriftRemoteChannel";

// End-to-end in-process: a real werift device answerer pairs with the host orchestration through an inline
// relay, driving the broker protocol + Ed25519 handshake + WebRTC to an open, byte-moving RemoteChannel.
test("host orchestration pairs a device over the handshake and opens a working WebRTC channel", async () => {
	const dir = mkdtempSync(join(tmpdir(), "trpi-remote-orchestration-"));
	try {
		const tokens = createPairingTokens();
		const { token } = tokens.issue("proj", Date.now());

		const { publicKey, privateKey } = generateKeyPairSync("ed25519");
		const devicePublicKey = (publicKey.export({ format: "jwk" }) as { x: string }).x;

		let resolveHost: (c: RemoteChannel) => void = () => {};
		let resolveDevice: (c: RemoteChannel) => void = () => {};
		const hostChannel = new Promise<RemoteChannel>((r) => {
			resolveHost = r;
		});
		const deviceChannel = new Promise<RemoteChannel>((r) => {
			resolveDevice = r;
		});

		const peer = createWeriftHostPeer();
		const session = createHostSession({
			handshake: createHostHandshake({
				newChallenge,
				consumeToken: (t) => tokens.consume(t),
				verifyProof: verifyPairingProof,
				registerDevice: (d) => addDevice(d, dir),
				newDeviceId: () => "dev-1",
			}),
			peer,
			send: (m) => void handleHostMessage(m),
		});
		session.onChannel((channel) => resolveHost(channel));

		const device = new RTCPeerConnection();
		device.onIceCandidate.subscribe((candidate) => {
			if (candidate) {
				session.receive({ kind: "candidate", candidate: JSON.stringify(candidate.toJSON()) });
			}
		});
		device.onDataChannel.subscribe((channel) => resolveDevice(toRemoteChannel(channel)));

		async function handleHostMessage(message: HostMessage): Promise<void> {
			if (message.kind === "challenge") {
				const signature = edSign(
					null,
					Buffer.from(message.challenge, "base64url"),
					privateKey,
				).toString("base64url");
				session.receive({ kind: "proof", signature });
			} else if (message.kind === "offer") {
				await device.setRemoteDescription({ type: "offer", sdp: message.sdp });
				const answer = await device.createAnswer();
				await device.setLocalDescription(answer);
				session.receive({ kind: "answer", sdp: answer.sdp });
			} else if (message.kind === "candidate") {
				await device.addIceCandidate(JSON.parse(message.candidate));
			} else if (message.kind === "rejected") {
				throw new Error(`pairing rejected: ${message.reason}`);
			}
		}

		session.receive({ kind: "hello", token, devicePublicKey, label: "Phone" });

		const [hostCh, deviceCh] = await Promise.all([hostChannel, deviceChannel]);
		const atDevice = new Promise<string>((r) =>
			deviceCh.onMessage((d) => r(new TextDecoder().decode(d))),
		);
		hostCh.send(new TextEncoder().encode("hello-remote"));
		expect(await atDevice).toBe("hello-remote");
		expect(loadDevices(dir).map((d) => d.label)).toEqual(["Phone"]);

		hostCh.close();
		deviceCh.close();
		peer.close();
		await device.close();
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}, 25_000);
