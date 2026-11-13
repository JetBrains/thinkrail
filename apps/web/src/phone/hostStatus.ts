import type { MessageKey } from "@thinkrail/locales";
import type { Translator } from "@thinkrail/locales/react";
import type { HostFailure, RemoteConnectCode } from "@thinkrail/remote-client";

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
