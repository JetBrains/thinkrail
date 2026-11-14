import type { MessageKey } from "@thinkrail/locales";
import type { Translator } from "@thinkrail/locales/react";
import type { HostFailure, HostStatus, RemoteConnectCode } from "@thinkrail/remote-client";

/** Each named reason says what to do next; `rejected` and `failed` fall back to the raw detail. */
const REMOTE_TEXT: Record<Exclude<RemoteConnectCode, "rejected" | "failed">, MessageKey> = {
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
};

export function serverFailureText(t: Translator, failure: HostFailure): string {
	if (failure.kind === "network") return t("panels.servers.errors.network");
	if (failure.kind === "remote" && failure.code !== "rejected" && failure.code !== "failed")
		return t(REMOTE_TEXT[failure.code]);
	return t("panels.servers.errors.error", { message: failure.message });
}

export function serverStatusText(t: Translator, status: HostStatus): string {
	if (status.kind === "connected") return t("panels.servers.connected");
	if (status.kind === "connecting") return t("panels.servers.connecting");
	return serverFailureText(t, status.failure);
}
