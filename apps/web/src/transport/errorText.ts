/**
 * A rejected `WsTransport.request` carries the host's error string (`new Error(msg.error)`), a timeout,
 * or a thrown non-Error. Normalize any of them to a short, display-ready line for an error turn/notice.
 */
export function errorText(err: unknown, fallback = "The request failed."): string {
	if (err instanceof Error && err.message) return err.message;
	if (typeof err === "string" && err) return err;
	return fallback;
}
