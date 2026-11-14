import { type RemoteConnectCode, RemoteConnectError } from "./connectError";
import { RelayUnreachableError } from "./relayPicker";
import type { HostConnectionStatus } from "./remoteSessions";

/**
 * Why a host could not be reached: no shared route (Wi‑Fi or Tailscale), a named reason the connector
 * reported, or an unexpected error with only its message.
 */
export type HostFailure =
	| { kind: "network" }
	| { kind: "remote"; code: RemoteConnectCode; message: string }
	| { kind: "error"; message: string };

export type HostStatus =
	| { kind: "connected" }
	| { kind: "connecting" }
	| { kind: "unreachable"; failure: HostFailure };

export const failureOf = (error: unknown): HostFailure => {
	if (error instanceof RelayUnreachableError) return { kind: "network" };
	if (error instanceof RemoteConnectError)
		return { kind: "remote", code: error.code, message: error.message };
	return { kind: "error", message: error instanceof Error ? error.message : String(error) };
};

/**
 * What fixes a failure on this device: `repair` — it must pair again (revoked, the host's key changed, an
 * expired code); `reconnect` — a passing problem a retry can fix; `none` — nothing here fixes it (this app is
 * too old for the host and needs an update).
 */
export type HostRecovery = "repair" | "reconnect" | "none";

export const recoveryOf = (failure: HostFailure): HostRecovery => {
	if (failure.kind !== "remote") return "reconnect";
	switch (failure.code) {
		case "unknown_device":
		case "identity_mismatch":
		case "code_expired":
			return "repair";
		case "app_outdated":
			return "none";
		default:
			return "reconnect";
	}
};

/** The controller's connection status as a screen shows it; a host it never connected reads connecting. */
export const hostStatusOf = (status: HostConnectionStatus | undefined): HostStatus =>
	status?.kind === "unreachable"
		? { kind: "unreachable", failure: failureOf(status.error) }
		: (status ?? { kind: "connecting" });
