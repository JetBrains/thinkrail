import { answerTranscript, offerTranscript } from "@thinkrail/contracts";
import type { PairedDevice } from "../remote";
import type { RemoteChannel } from "./channel";
import type { HostPeer } from "./hostPeer";
import type { DeviceMessage, HostMessage } from "./signalingProtocol";
import type { AuthorizedDevice, HostHandshake } from "./signalingSession";

export interface HostSessionDeps {
	handshake: HostHandshake;
	peer: HostPeer;
	/** Sends a host signaling frame back to the device (through the broker). */
	send: (message: HostMessage) => void;
	/** Signs with the host identity key, so the device can tell the offer came from the host it paired. */
	sign: (data: Uint8Array) => Uint8Array;
	/** Verifies a device signature against its raw public key. */
	verify: (publicKeyRaw: string, data: Uint8Array, signature: Uint8Array) => boolean;
}

export interface HostSession {
	/** Feeds a device signaling frame: the authorization handshake first, then WebRTC negotiation. */
	receive(message: DeviceMessage): void;
	/**
	 * Feeds a frame that did not parse. A device built for this protocol never sends one, so it means the app
	 * is older than the host: say so and end the session, rather than drop it and leave the phone waiting.
	 */
	receiveUnreadable(): void;
	onChannel(handler: (channel: RemoteChannel, device: PairedDevice) => void): void;
	close(): void;
}

/** What an older app, which knows no reject codes, shows the user as-is. */
export const OUTDATED_APP_REASON =
	"this ThinkRail app is older than the one on the computer; update it on the phone and scan a new QR code";

/**
 * One remote device session on the host: runs the authorize-before-negotiate handshake, and only once the
 * device is accepted does it start the WebRTC peer. Both SDPs are signed — the host's offer with its identity
 * key (bound to the device's nonce), the device's answer with its device key (bound to the challenge) — so the
 * relay carrying them cannot substitute its own WebRTC endpoint on either side.
 */
export function createHostSession(deps: HostSessionDeps): HostSession {
	let authorized: AuthorizedDevice | null = null;
	let closed = false;
	let emitChannel: (channel: RemoteChannel, device: PairedDevice) => void = () => {};

	const close = (): void => {
		closed = true;
		deps.peer.close();
	};

	deps.peer.onLocalSignal((signal) => {
		if (!authorized || closed) return;
		if (signal.kind === "offer" && signal.sdp !== undefined) {
			const transcript = offerTranscript(authorized.nonce, authorized.challenge, signal.sdp);
			const signature = Buffer.from(deps.sign(transcript)).toString("base64url");
			deps.send({ kind: "offer", sdp: signal.sdp, signature });
		} else if (signal.kind === "candidate" && signal.candidate !== undefined) {
			deps.send({ kind: "candidate", candidate: signal.candidate });
		}
	});
	deps.peer.onChannel((channel) => {
		if (authorized && !closed) emitChannel(channel, authorized.device);
	});

	return {
		receive(message) {
			if (closed) return;
			if (authorized === null) {
				const step = deps.handshake.handle(message);
				if (step.send) deps.send(step.send);
				if (step.authorized) {
					authorized = step.authorized;
					void deps.peer.start();
				}
				return;
			}
			if (message.kind === "answer") {
				const genuine = deps.verify(
					authorized.device.publicKey,
					answerTranscript(authorized.challenge, message.sdp),
					Buffer.from(message.signature, "base64url"),
				);
				if (!genuine) {
					deps.send({ kind: "rejected", reason: "answer signature rejected", code: "denied" });
					close();
					return;
				}
				void deps.peer.acceptAnswer(message.sdp);
			} else if (message.kind === "candidate") {
				void deps.peer.addCandidate(message.candidate);
			}
		},
		receiveUnreadable() {
			if (closed) return;
			deps.send({ kind: "rejected", reason: OUTDATED_APP_REASON, code: "outdated_app" });
			close();
		},
		onChannel(handler) {
			emitChannel = handler;
		},
		close,
	};
}
