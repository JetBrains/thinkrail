import type { DeviceMessage, HostMessage, RejectCode } from "@thinkrail/contracts";
import { answerTranscript, offerTranscript } from "@thinkrail/contracts";
import { logger } from "../log";
import type { PairedDevice } from "../remote";
import type { RemoteChannel } from "./channel";
import type { HostPeer } from "./hostPeer";
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
	/** How long the session may take to open its channel before it is closed; `SIGNALING_WINDOW_MS` by default. */
	signalingWindowMs?: number;
}

export interface HostSession {
	/** Feeds a device signaling frame: the authorization handshake first, then WebRTC negotiation. */
	receive(message: DeviceMessage): void;
	/** Feeds a frame that did not parse: the app is older than the host, so the session ends `outdated_app`. */
	receiveUnreadable(): void;
	/** The open channel, the device it authorized, and the wire protocol that device speaks. */
	onChannel(
		handler: (channel: RemoteChannel, device: PairedDevice, protocolVersion: number) => void,
	): void;
	/** True once the data channel is open: signaling is done and the session must outlive its broker entry. */
	readonly opened: boolean;
	/** The session ended, by its own terminal step or deadline or by `close()`; heard once. */
	onClose(handler: () => void): void;
	close(): void;
}

/** How long a device session may take from its first frame to an open channel, on every signaling route. */
export const SIGNALING_WINDOW_MS = 60_000;

const log = logger("remote-transport");

/** What an older app, which knows no reject codes, shows the user as-is. */
export const OUTDATED_APP_REASON =
	"this ThinkRail app is older than the one on the computer; update it on the phone and scan a new QR code";

export function createHostSession(deps: HostSessionDeps): HostSession {
	let authorized: AuthorizedDevice | null = null;
	let closed = false;
	let opened = false;
	let emitChannel: (channel: RemoteChannel, device: PairedDevice, protocolVersion: number) => void =
		() => {};
	let emitClose: () => void = () => {};

	const close = (): void => {
		if (closed) return;
		closed = true;
		clearTimeout(deadline);
		deps.peer.close();
		emitClose();
	};
	const refuse = (reason: string, code: RejectCode): void => {
		deps.send({ kind: "rejected", reason, code });
		close();
	};
	const deadline = setTimeout(close, deps.signalingWindowMs ?? SIGNALING_WINDOW_MS);
	deadline.unref?.();

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
		if (!authorized || closed) return;
		opened = true;
		clearTimeout(deadline);
		emitChannel(channel, authorized.device, authorized.protocolVersion);
	});

	return {
		receive(message) {
			if (closed) return;
			if (authorized === null) {
				const step = deps.handshake.handle(message);
				if (step.send) deps.send(step.send);
				if (step.authorized) {
					authorized = step.authorized;
					deps.peer.start().catch((error: unknown) => {
						log.warn("a device session's WebRTC peer could not start", error);
						if (!closed) refuse("the computer could not start the connection", "denied");
					});
				} else if (step.done) close();
				return;
			}
			if (message.kind === "answer") {
				const genuine = deps.verify(
					authorized.device.publicKey,
					answerTranscript(authorized.challenge, message.sdp),
					Buffer.from(message.signature, "base64url"),
				);
				if (!genuine) return refuse("answer signature rejected", "denied");
				deps.peer.acceptAnswer(message.sdp).catch((error: unknown) => {
					log.warn("a device session's answer could not be applied", error);
					if (!closed) refuse("the device's answer could not be applied", "denied");
				});
			} else if (message.kind === "candidate") {
				deps.peer
					.addCandidate(message.candidate)
					.catch((error: unknown) => log.debug("a device ICE candidate was refused", error));
			}
		},
		receiveUnreadable() {
			if (closed) return;
			refuse(OUTDATED_APP_REASON, "outdated_app");
		},
		onChannel(handler) {
			emitChannel = handler;
		},
		get opened() {
			return opened;
		},
		onClose(handler) {
			emitClose = handler;
		},
		close,
	};
}
