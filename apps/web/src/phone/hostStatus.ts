import type { Translator } from "@thinkrail/locales/react";
import type { HostConnectionStatus } from "@thinkrail/remote-client";
import {
	type FailureTexts,
	failureKey,
	failureOf,
	type HostFailure,
} from "../remote/connectFailure";

export { failureOf, type HostFailure } from "../remote/connectFailure";

export type HostStatus =
	| { kind: "connected" }
	| { kind: "connecting" }
	| { kind: "unreachable"; failure: HostFailure };

const PHONE_TEXTS: FailureTexts = {
	network: "mobile.hosts.networkFailure",
	codes: {
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
	},
};

/** Each named reason says what to do next; `rejected`, `failed` and the unexpected fall back to the raw detail. */
export const failureText = (t: Translator, failure: HostFailure): string => {
	const key = failureKey(failure, PHONE_TEXTS);
	if (key) return t(key);
	return t("mobile.hosts.errorFailure", {
		message: failure.kind === "network" ? "" : failure.message,
	});
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
