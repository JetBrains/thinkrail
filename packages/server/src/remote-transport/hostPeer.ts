import { type IceServer, withPublicStun } from "@thinkrail/contracts";
import { RTCPeerConnection } from "werift";
import type { RemoteChannel } from "./channel";
import type { PortLease, PortMapper } from "./natPmp";
import { toRemoteChannel } from "./weriftRemoteChannel";

export interface HostPeerSignal {
	kind: "offer" | "candidate";
	sdp?: string;
	candidate?: string;
}

export interface HostPeer {
	start(): Promise<void>;
	acceptAnswer(sdp: string): Promise<void>;
	addCandidate(candidate: string): Promise<void>;
	onLocalSignal(handler: (signal: HostPeerSignal) => void): void;
	onChannel(handler: (channel: RemoteChannel) => void): void;
	close(): void;
}

interface CandidateInit {
	candidate: string;
	sdpMid?: string;
	sdpMLineIndex?: number;
}

const PRIVATE_IPV4 = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/;
/** RFC 8445 priority for a server-reflexive candidate (type preference 100) of component 1. */
const MAPPED_PRIORITY = (100 << 24) + (65_535 << 8) + 255;

/** The local UDP port of a private-IPv4 host candidate, the one a router can forward to. */
export function mappablePort(candidate: string): { address: string; port: number } | null {
	const parts = candidate.replace(/^candidate:/, "").split(" ");
	const [, , protocol, , address, port, , type] = parts;
	if (protocol?.toLowerCase() !== "udp" || type !== "host" || !address) return null;
	if (!PRIVATE_IPV4.test(address)) return null;
	const number = Number(port);
	return Number.isInteger(number) && number > 0 ? { address, port: number } : null;
}

/** The candidate a router port mapping adds: the public address, related to the local one it forwards to. */
export function mappedCandidate(
	local: CandidateInit,
	from: { address: string; port: number },
	lease: { address: string; port: number },
): string {
	const foundation = `pmp${from.port}`;
	const candidate = `candidate:${foundation} 1 udp ${MAPPED_PRIORITY} ${lease.address} ${lease.port} typ srflx raddr ${from.address} rport ${from.port}`;
	return JSON.stringify({
		candidate,
		...(local.sdpMid !== undefined ? { sdpMid: local.sdpMid } : {}),
		...(local.sdpMLineIndex !== undefined ? { sdpMLineIndex: local.sdpMLineIndex } : {}),
	});
}

export function createWeriftHostPeer(
	iceServers: readonly IceServer[] = withPublicStun(),
	portMapper?: PortMapper,
): HostPeer {
	const pc = new RTCPeerConnection({ iceServers: [...iceServers] });
	const leases: PortLease[] = [];
	let closed = false;
	const releaseLeases = (): void => {
		closed = true;
		for (const lease of leases.splice(0)) lease.release();
	};
	let emitSignal: (signal: HostPeerSignal) => void = () => {};
	let emitChannel: (channel: RemoteChannel) => void = () => {};
	let remoteSignals: Promise<void> = Promise.resolve();
	const inOrder = (apply: () => Promise<unknown>): Promise<void> => {
		const next = remoteSignals.then(async () => {
			await apply();
		});
		remoteSignals = next.catch(() => {});
		return next;
	};

	let heldCandidates: HostPeerSignal[] | null = [];

	const emitCandidate = (candidate: string): void => {
		const signal: HostPeerSignal = { kind: "candidate", candidate };
		if (heldCandidates) heldCandidates.push(signal);
		else emitSignal(signal);
	};
	const mapPort = (local: CandidateInit): void => {
		const from = portMapper ? mappablePort(local.candidate) : null;
		if (!portMapper || !from) return;
		void portMapper.open(from.port).then((lease) => {
			if (!lease) return;
			if (closed) return lease.release();
			leases.push(lease);
			emitCandidate(mappedCandidate(local, from, lease));
		});
	};

	pc.onIceCandidate.subscribe((candidate) => {
		if (!candidate) return;
		const init = candidate.toJSON() as CandidateInit;
		emitCandidate(JSON.stringify(init));
		mapPort(init);
	});
	pc.connectionStateChange.subscribe((state) => {
		if (state === "closed" || state === "failed") releaseLeases();
	});

	return {
		async start() {
			const channel = pc.createDataChannel("wire");
			channel.stateChanged.subscribe((state) => {
				if (state === "open") emitChannel(toRemoteChannel(channel));
				// Without this the device never sees the connection end.
				else if (state === "closed") void pc.close();
			});
			const offer = await pc.createOffer();
			await pc.setLocalDescription(offer);
			emitSignal({ kind: "offer", sdp: offer.sdp });
			const held = heldCandidates ?? [];
			heldCandidates = null;
			for (const signal of held) emitSignal(signal);
		},
		acceptAnswer(sdp) {
			return inOrder(() => pc.setRemoteDescription({ type: "answer", sdp }));
		},
		addCandidate(candidate) {
			return inOrder(() => pc.addIceCandidate(JSON.parse(candidate)));
		},
		onLocalSignal(handler) {
			emitSignal = handler;
		},
		onChannel(handler) {
			emitChannel = handler;
		},
		close() {
			releaseLeases();
			void pc.close();
		},
	};
}
