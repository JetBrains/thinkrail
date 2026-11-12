import { t } from "@thinkrail/locales/react";

export function errorText(
	err: unknown,
	fallback = t("app.transport.requestFailedFallback"),
): string {
	if (err instanceof Error && err.message) return err.message;
	if (typeof err === "string" && err) return err;
	return fallback;
}
