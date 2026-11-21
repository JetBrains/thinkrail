import type { Translator } from "@thinkrail/locales/react";
import type { HostFailure } from "@thinkrail/remote-client";
import { type FailureTexts, failureKey } from "../remote";

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
