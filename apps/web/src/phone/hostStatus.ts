import type { MessageKey } from "@thinkrail/locales";
import type { Translator } from "@thinkrail/locales/react";
import {
	type HostConnectionStatus,
	RelayUnreachableError,
	type RemoteConnectCode,
	RemoteConnectError,
} from "@thinkrail/remote-client";

/**
 * Why a computer could not be reached: no shared route (Wi‑Fi or Tailscale), a named reason the connector
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

/** Each named reason says what to do next; `rejected` and `failed` fall back to the raw detail. */
const REMOTE_TEXT: Record<Exclude<RemoteConnectCode, "rejected" | "failed">, MessageKey> = {
	invalid_link: "mobile.errors.invalidLink",
	host_offline: "mobile.errors.hostOffline",
	host_busy: "mobile.errors.hostBusy",
	host_silent: "mobile.errors.hostSilent",
	code_expired: "mobile.errors.codeExpired",
	unknown_device: "mobile.errors.unknownDevice",
	app_outdated: "mobile.errors.appOutdated",
	identity_mismatch: "mobile.errors.identityMismatch",
	no_direct_route: "mobile.errors.noDirectRoute",
	relay_lost: "mobile.errors.relayLost",
};

export const failureText = (t: Translator, failure: HostFailure): string => {
	if (failure.kind === "network") return t("mobile.hosts.networkFailure");
	if (failure.kind === "remote" && failure.code !== "rejected" && failure.code !== "failed")
		return t(REMOTE_TEXT[failure.code]);
	return t("mobile.hosts.errorFailure", { message: failure.message });
};

/**
 * What the banner offers for a failure: `repair` — this phone must pair again (revoked, the computer's key
 * changed, an expired code), so it scans a new QR; `reconnect` — a passing problem a retry can fix; `none` —
 * nothing on the phone fixes it (the app is too old for the computer and needs an update).
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

/** The controller's connection status as the screens show it; a host it never connected reads Connecting…. */
export const hostStatusOf = (status: HostConnectionStatus | undefined): HostStatus =>
	status?.kind === "unreachable"
		? { kind: "unreachable", failure: failureOf(status.error) }
		: (status ?? { kind: "connecting" });
