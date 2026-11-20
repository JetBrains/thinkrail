import type { MessageKey } from "@thinkrail/locales";
import type { Translator } from "@thinkrail/locales/react";
import {
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

export const failureOf = (error: unknown): HostFailure => {
	if (error instanceof RelayUnreachableError) return { kind: "network" };
	if (error instanceof RemoteConnectError)
		return { kind: "remote", code: error.code, message: error.message };
	return { kind: "error", message: error instanceof Error ? error.message : String(error) };
};

/** A connect code with a reason of its own; `rejected` and `failed` carry only the host's detail. */
export type NamedConnectCode = Exclude<RemoteConnectCode, "rejected" | "failed">;

/** One shell's wording: what to do when no route answered, and per named reason. */
export interface FailureTexts {
	network: MessageKey;
	codes: Record<NamedConnectCode, MessageKey>;
}

/** The key that says what to do about a failure; null for one without a named reason. */
export const failureKey = (failure: HostFailure, texts: FailureTexts): MessageKey | null => {
	if (failure.kind === "network") return texts.network;
	if (failure.kind === "remote" && failure.code !== "rejected" && failure.code !== "failed")
		return texts.codes[failure.code];
	return null;
};

const IDE_TEXTS: FailureTexts = {
	network: "panels.connectByLink.errors.network",
	codes: {
		invalid_link: "panels.connectByLink.invalidLink",
		host_offline: "panels.connectByLink.errors.hostOffline",
		host_busy: "panels.connectByLink.errors.hostBusy",
		host_silent: "panels.connectByLink.errors.hostSilent",
		code_expired: "panels.connectByLink.errors.codeExpired",
		unknown_device: "panels.connectByLink.errors.unknownDevice",
		app_outdated: "panels.connectByLink.errors.appOutdated",
		identity_mismatch: "panels.connectByLink.errors.identityMismatch",
		no_direct_route: "panels.connectByLink.errors.noDirectRoute",
		relay_lost: "panels.connectByLink.errors.relayLost",
	},
};

/** The IDE's line for a failed or lost remote host: never the raw detail, which is English and names addresses. */
export const connectFailureText = (t: Translator, failure: HostFailure): string =>
	t(failureKey(failure, IDE_TEXTS) ?? "panels.connectByLink.errors.failed");
