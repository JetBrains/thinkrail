import { t } from "@thinkrail/locales/react";
import { useEffect, useRef } from "react";
import { errorText } from "../transport";

const SESSION_CLOSED = "remote session closed";

const codeOf = (error: unknown): unknown =>
	typeof error === "object" && error !== null ? Reflect.get(error, "code") : undefined;

/** Why a request failed, in the phone's language: a known host refusal or a closed connection by its own line, anything else by its message. */
export function reasonOf(error: unknown): string {
	const code = codeOf(error);
	if (code === "REMOTE_DEVICE_READ_ONLY") return t("mobile.errors.requestReadOnly");
	if (code === "REMOTE_DEVICE_REVOKED") return t("mobile.errors.requestRevoked");
	if (error instanceof Error && error.message === SESSION_CLOSED)
		return t("mobile.errors.requestClosed");
	return errorText(error);
}

/** Runs one task at a time: a call while one is in flight is dropped (null), so a second tap cannot fire it twice. */
export function singleFlight(onPending: (pending: boolean) => void = () => {}) {
	let running = false;
	return <T>(task: () => Promise<T>): Promise<T> | null => {
		if (running) return null;
		running = true;
		onPending(true);
		return task().finally(() => {
			running = false;
			onPending(false);
		});
	};
}

/** False once the screen left, so a late answer does not navigate from wherever the user went since. */
export function useMounted(): { readonly current: boolean } {
	const mounted = useRef(true);
	useEffect(() => {
		mounted.current = true;
		return () => {
			mounted.current = false;
		};
	}, []);
	return mounted;
}
