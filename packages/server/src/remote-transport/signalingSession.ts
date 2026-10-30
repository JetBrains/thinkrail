import { randomUUID } from "node:crypto";
import type { PairedDevice, PairingProof, PairingRequest } from "../remote";
import type { DeviceMessage, HostMessage } from "./signalingProtocol";

export interface HandshakeDeps {
	newChallenge: () => string;
	/** Single-use consume of the QR pairing token; null when unknown or expired. */
	consumeToken: (token: string) => PairingRequest | null;
	verifyProof: (proof: PairingProof) => boolean;
	registerDevice: (device: PairedDevice) => void;
	now?: () => number;
	newDeviceId?: () => string;
}

export interface AuthorizedDevice {
	device: PairedDevice;
	projectRef: string;
}

export interface HandshakeStep {
	send?: HostMessage;
	authorized?: AuthorizedDevice;
	/** True once the handshake is terminal (accepted or rejected); later frames are ignored. */
	done?: boolean;
}

type State =
	| { phase: "await-hello" }
	| {
			phase: "await-proof";
			devicePublicKey: string;
			label: string;
			challenge: string;
			projectRef: string;
	  }
	| { phase: "closed" };

export interface HostHandshake {
	handle(message: DeviceMessage): HandshakeStep;
}

/**
 * The host side of the pairing authorization handshake, run over the signaling channel *before* any WebRTC
 * negotiation: `hello` → `challenge` → `proof` → `accepted`/`rejected`. Pure and dependency-injected, so an
 * unauthorized peer never reaches SDP/ICE exchange. The media negotiation that follows an `authorized` step
 * is the WebRTC adapter's concern.
 */
export function createHostHandshake(deps: HandshakeDeps): HostHandshake {
	const now = deps.now ?? Date.now;
	const newDeviceId = deps.newDeviceId ?? randomUUID;
	let state: State = { phase: "await-hello" };

	const reject = (reason: string): HandshakeStep => {
		state = { phase: "closed" };
		return { send: { kind: "rejected", reason }, done: true };
	};

	return {
		handle(message: DeviceMessage): HandshakeStep {
			if (state.phase === "closed") return { done: true };

			if (state.phase === "await-hello") {
				if (message.kind !== "hello") return reject("expected hello");
				const request = deps.consumeToken(message.token);
				if (!request) return reject("invalid or expired pairing code");
				const challenge = deps.newChallenge();
				state = {
					phase: "await-proof",
					devicePublicKey: message.devicePublicKey,
					label: message.label,
					challenge,
					projectRef: request.projectRef,
				};
				return { send: { kind: "challenge", challenge } };
			}

			if (message.kind !== "proof") return reject("expected proof");
			const ok = deps.verifyProof({
				devicePublicKey: state.devicePublicKey,
				challenge: state.challenge,
				signature: message.signature,
			});
			if (!ok) return reject("pairing proof rejected");
			const device: PairedDevice = {
				id: newDeviceId(),
				label: state.label,
				publicKey: state.devicePublicKey,
				pairedAt: now(),
			};
			deps.registerDevice(device);
			const authorized: AuthorizedDevice = { device, projectRef: state.projectRef };
			state = { phase: "closed" };
			return { send: { kind: "accepted" }, authorized, done: true };
		},
	};
}
