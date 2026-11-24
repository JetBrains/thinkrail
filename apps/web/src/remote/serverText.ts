import type { Translator } from "@thinkrail/locales/react";
import type { HostFailure, HostStatus } from "@thinkrail/remote-client";
import { type FailureTexts, failureKey } from "./connectFailure";

const SERVER_TEXTS: FailureTexts = {
	network: "panels.servers.errors.network",
	codes: {
		invalid_link: "panels.servers.errors.invalidLink",
		host_offline: "panels.servers.errors.hostOffline",
		host_busy: "panels.servers.errors.hostBusy",
		host_silent: "panels.servers.errors.hostSilent",
		code_expired: "panels.servers.errors.codeExpired",
		unknown_device: "panels.servers.errors.unknownDevice",
		app_outdated: "panels.servers.errors.appOutdated",
		identity_mismatch: "panels.servers.errors.identityMismatch",
		no_direct_route: "panels.servers.errors.noDirectRoute",
		relay_lost: "panels.servers.errors.relayLost",
	},
};

/** A server's failure in the IDE's words: never the raw detail, which is English and names addresses. */
export function serverFailureText(t: Translator, failure: HostFailure): string {
	return t(failureKey(failure, SERVER_TEXTS) ?? "panels.servers.errors.failed");
}

export function serverStatusText(t: Translator, status: HostStatus): string {
	if (status.kind === "connected") return t("panels.servers.connected");
	if (status.kind === "connecting") return t("panels.servers.connecting");
	return serverFailureText(t, status.failure);
}
