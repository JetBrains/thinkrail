import type { PairedDevice } from "../remote";
import type { RemoteChannel } from "./channel";
import type { HostPeer } from "./hostPeer";
import type { DeviceMessage, HostMessage } from "./signalingProtocol";
import type { HostHandshake } from "./signalingSession";

export interface HostSessionDeps {
	handshake: HostHandshake;
	peer: HostPeer;
	/** Sends a host signaling frame back to the device (through the broker). */
	send: (message: HostMessage) => void;
}

export interface HostSession {
	/** Feeds a device signaling frame: the authorization handshake first, then WebRTC negotiation. */
	receive(message: DeviceMessage): void;
	onChannel(handler: (channel: RemoteChannel, device: PairedDevice) => void): void;
	close(): void;
}

/**
 * One remote device session on the host: runs the authorize-before-negotiate handshake, and only once the
 * device is accepted does it start the WebRTC peer and relay the device's answer/candidates into it. Ties
 * together the `remote` pairing primitives (via the injected handshake), the signaling protocol, and the
 * WebRTC peer, with no transport I/O of its own.
 */
export function createHostSession(deps: HostSessionDeps): HostSession {
	let device: PairedDevice | null = null;
	let emitChannel: (channel: RemoteChannel, device: PairedDevice) => void = () => {};

	deps.peer.onLocalSignal((signal) => {
		if (signal.kind === "offer" && signal.sdp !== undefined) {
			deps.send({ kind: "offer", sdp: signal.sdp });
		} else if (signal.kind === "candidate" && signal.candidate !== undefined) {
			deps.send({ kind: "candidate", candidate: signal.candidate });
		}
	});
	deps.peer.onChannel((channel) => {
		if (device) emitChannel(channel, device);
	});

	return {
		receive(message) {
			if (device === null) {
				const step = deps.handshake.handle(message);
				if (step.send) deps.send(step.send);
				if (step.authorized) {
					device = step.authorized.device;
					void deps.peer.start();
				}
				return;
			}
			if (message.kind === "answer") void deps.peer.acceptAnswer(message.sdp);
			else if (message.kind === "candidate") void deps.peer.addCandidate(message.candidate);
		},
		onChannel(handler) {
			emitChannel = handler;
		},
		close() {
			deps.peer.close();
		},
	};
}
