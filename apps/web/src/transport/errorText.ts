import { t } from "@thinkrail/locales/react";
import { wsErrorCode } from "./requestError";

export function errorText(
	err: unknown,
	fallback = t("app.transport.requestFailedFallback"),
): string {
	if (wsErrorCode(err) === "REQUEST_REPLAY_OVERFLOW") return t("app.transport.replayOverflow");
	if (err instanceof Error && err.message) return err.message;
	if (typeof err === "string" && err) return err;
	return fallback;
}
