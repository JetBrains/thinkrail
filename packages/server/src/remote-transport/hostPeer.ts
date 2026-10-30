import { RTCPeerConnection } from "werift";
import type { RemoteChannel } from "./channel";
import { toRemoteChannel } from "./weriftRemoteChannel";

export interface HostPeerSignal {
	kind: "offer" | "candidate";
	sdp?: string;
	candidate?: string;
}

/**
 * The host as the WebRTC offerer: it creates the DataChannel and offer after authorization, emits local
 * SDP/ICE for the signaling layer to relay, consumes the device's answer/candidates, and surfaces the opened
 * channel as a `RemoteChannel`. Kept behind an interface so the session orchestrator is testable with a fake.
 */
export interface HostPeer {
	start(): Promise<void>;
	acceptAnswer(sdp: string): Promise<void>;
	addCandidate(candidate: string): Promise<void>;
	onLocalSignal(handler: (signal: HostPeerSignal) => void): void;
	onChannel(handler: (channel: RemoteChannel) => void): void;
	close(): void;
}

export function createWeriftHostPeer(): HostPeer {
	const pc = new RTCPeerConnection();
	let emitSignal: (signal: HostPeerSignal) => void = () => {};
	let emitChannel: (channel: RemoteChannel) => void = () => {};

	pc.onIceCandidate.subscribe((candidate) => {
		if (candidate) emitSignal({ kind: "candidate", candidate: JSON.stringify(candidate.toJSON()) });
	});

	return {
		async start() {
			const channel = pc.createDataChannel("wire");
			channel.stateChanged.subscribe((state) => {
				if (state === "open") emitChannel(toRemoteChannel(channel));
			});
			const offer = await pc.createOffer();
			await pc.setLocalDescription(offer);
			emitSignal({ kind: "offer", sdp: offer.sdp });
		},
		async acceptAnswer(sdp) {
			await pc.setRemoteDescription({ type: "answer", sdp });
		},
		async addCandidate(candidate) {
			await pc.addIceCandidate(JSON.parse(candidate));
		},
		onLocalSignal(handler) {
			emitSignal = handler;
		},
		onChannel(handler) {
			emitChannel = handler;
		},
		close() {
			void pc.close();
		},
	};
}
