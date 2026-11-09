import type { RejectCode } from "@thinkrail/contracts";

/**
 * Why a connection to a computer could not be opened, named so the app can say what to do next:
 * - `invalid_link` — the text is not a `thinkrail://pair` link this app can read;
 * - `host_offline` — the relay answered but no host is registered under the key (ThinkRail is closed, or phone
 *   access is off);
 * - `host_busy` — the host is at its session limit;
 * - `host_silent` — the host never answered the handshake (an older or stuck host);
 * - `code_expired` — the QR code is expired or already used;
 * - `unknown_device` — the computer has no record of this phone (revoked or forgotten);
 * - `app_outdated` — the host could not read this app's frames: the app is older than the host;
 * - `identity_mismatch` — the offer was not signed by the computer from the QR code;
 * - `no_direct_route` — signaling worked but WebRTC never connected (no shared network path);
 * - `relay_lost` — the relay connection dropped mid-handshake;
 * - `rejected` / `failed` — any other refusal or error, with the detail in `message`.
 * An unreachable relay is the separate `RelayUnreachableError`.
 */
export type RemoteConnectCode =
	| "invalid_link"
	| "host_offline"
	| "host_busy"
	| "host_silent"
	| "code_expired"
	| "unknown_device"
	| "app_outdated"
	| "identity_mismatch"
	| "no_direct_route"
	| "relay_lost"
	| "rejected"
	| "failed";

export class RemoteConnectError extends Error {
	readonly code: RemoteConnectCode;
	constructor(code: RemoteConnectCode, message: string) {
		super(message);
		this.code = code;
		this.name = "RemoteConnectError";
	}
}

/** The relay's own `error` frame, by the reasons `packages/relay` sends. */
export function brokerFailure(reason: string): RemoteConnectError {
	if (reason === "no host available") return new RemoteConnectError("host_offline", reason);
	if (reason === "host busy") return new RemoteConnectError("host_busy", reason);
	return new RemoteConnectError("failed", reason);
}

/** The host's `rejected` frame; a host too old to send a code is read by its reason. */
export function hostRejection(reason: string, code: RejectCode | undefined): RemoteConnectError {
	switch (code) {
		case "invalid_code":
			return new RemoteConnectError("code_expired", reason);
		case "unknown_device":
			return new RemoteConnectError("unknown_device", reason);
		case "outdated_app":
			return new RemoteConnectError("app_outdated", reason);
		case "denied":
			return new RemoteConnectError("rejected", reason);
		default:
			if (reason === "invalid or expired pairing code")
				return new RemoteConnectError("code_expired", reason);
			if (reason.startsWith("unknown device"))
				return new RemoteConnectError("unknown_device", reason);
			return new RemoteConnectError("rejected", reason);
	}
}
