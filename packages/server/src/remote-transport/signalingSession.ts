import { randomUUID } from "node:crypto";
import type { PairedDevice, PairingProof, PairingRequest } from "../remote";
import type { DeviceMessage, HostMessage } from "./signalingProtocol";

export interface HandshakeDeps {
	newChallenge: () => string;
	/** Single-use consume of the QR pairing token named by its id; null when unknown or expired. */
	consumeToken: (tokenId: string) => PairingRequest | null;
	verifyProof: (proof: PairingProof) => boolean;
	/** Checks the first-pairing HMAC that proves the device read the QR token (it never sends the token). */
	verifyMac: (token: string, devicePublicKey: string, challenge: string, mac: string) => boolean;
	registerDevice: (device: PairedDevice) => void;
	/** Looks up an already-paired device by public key; used for token-less reconnect (`resume`). */
	findDevice: (devicePublicKey: string) => PairedDevice | null;
	now?: () => number;
	newDeviceId?: () => string;
}

export interface AuthorizedDevice {
	device: PairedDevice;
	projectRef: string;
	/** The device's fresh nonce, which the host's signed offer is bound to. */
	nonce: string;
	/** This attempt's challenge, which the device's signed answer is bound to. */
	challenge: string;
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
			nonce: string;
			projectRef: string;
			/** The QR token of a first pairing, whose HMAC the proof must carry. */
			token?: string;
			/** Set when resuming an already-paired device, so its id is preserved rather than minted anew. */
			deviceId?: string;
	  }
	| { phase: "closed" };

export interface HostHandshake {
	handle(message: DeviceMessage): HandshakeStep;
}

/**
 * The host side of the pairing authorization handshake, run over the signaling channel *before* any WebRTC
 * negotiation: `hello` → `challenge` → `proof` (with the QR-token HMAC on a first pairing) →
 * `accepted`/`rejected`. Pure and dependency-injected, so an unauthorized peer never reaches SDP/ICE exchange. The media negotiation that follows an `authorized` step
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
				if (message.kind === "hello") {
					const request = deps.consumeToken(message.tokenId);
					if (!request) return reject("invalid or expired pairing code");
					const challenge = deps.newChallenge();
					state = {
						phase: "await-proof",
						devicePublicKey: message.devicePublicKey,
						label: message.label,
						challenge,
						nonce: message.nonce,
						projectRef: request.projectRef,
						token: request.token,
					};
					return { send: { kind: "challenge", challenge } };
				}
				if (message.kind === "resume") {
					const known = deps.findDevice(message.devicePublicKey);
					if (!known) return reject("unknown device; pair again with a fresh link");
					const challenge = deps.newChallenge();
					state = {
						phase: "await-proof",
						devicePublicKey: known.publicKey,
						label: known.label,
						challenge,
						nonce: message.nonce,
						projectRef: "",
						deviceId: known.id,
					};
					return { send: { kind: "challenge", challenge } };
				}
				return reject("expected hello or resume");
			}

			if (message.kind !== "proof") return reject("expected proof");
			if (
				state.token !== undefined &&
				(message.mac === undefined ||
					!deps.verifyMac(state.token, state.devicePublicKey, state.challenge, message.mac))
			) {
				return reject("pairing code check failed");
			}
			const ok = deps.verifyProof({
				devicePublicKey: state.devicePublicKey,
				challenge: state.challenge,
				signature: message.signature,
			});
			if (!ok) return reject("pairing proof rejected");
			const device: PairedDevice = {
				id: state.deviceId ?? newDeviceId(),
				label: state.label,
				publicKey: state.devicePublicKey,
				pairedAt: now(),
			};
			deps.registerDevice(device);
			const authorized: AuthorizedDevice = {
				device,
				projectRef: state.projectRef,
				nonce: state.nonce,
				challenge: state.challenge,
			};
			state = { phase: "closed" };
			return { send: { kind: "accepted" }, authorized, done: true };
		},
	};
}
