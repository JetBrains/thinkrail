import { EN } from "@thinkrail/locales";
import { t } from "@thinkrail/locales/react";
import { RequestError } from "./requestError";

function isErrorKey(key: string): key is Extract<keyof typeof EN, `errors.${string}`> {
	return key.startsWith("errors.") && Object.hasOwn(EN, key);
}

function localizedError(err: RequestError): string | undefined {
	const key = `errors.${err.code}`;
	if (!isErrorKey(key)) return undefined;
	const values: Record<string, string | number> = {};
	for (const match of EN[key].matchAll(/\{\{\s*(\w+)\s*\}\}/g)) {
		const name = match[1];
		const params = err.errorParams;
		if (
			!name ||
			!params ||
			typeof params !== "object" ||
			Array.isArray(params) ||
			!Object.hasOwn(params, name)
		)
			return undefined;
		const value = params[name];
		if (typeof value !== "string" && !(typeof value === "number" && Number.isFinite(value)))
			return undefined;
		values[name] = value;
	}
	return t(key, { replace: values });
}

export function errorText(
	err: unknown,
	fallback = t("app.transport.requestFailedFallback"),
): string {
	if (err instanceof RequestError) {
		const localized = localizedError(err);
		if (localized) return localized;
	}
	if (err instanceof Error && err.message) return err.message;
	if (typeof err === "string" && err) return err;
	return fallback;
}
