import type { MessageKey } from "@thinkrail/locales";
import type { HostFailure, RemoteConnectCode } from "@thinkrail/remote-client";

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
