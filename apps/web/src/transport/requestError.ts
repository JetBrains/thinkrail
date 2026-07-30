import type { WsErrorCode } from "@thinkrail/contracts";

/**
 * A rejected request that carries the host's named failure code (`WsResponse.errorCode`) alongside its
 * message, so a caller can react to *that* failure specifically. Everything else — a timeout, a dropped
 * socket, an unnamed host error — rejects with a plain `Error` and therefore has no code, which is exactly
 * how a caller tells "this specific thing happened" from "the read failed".
 */
export class RequestError extends Error {
	readonly code: WsErrorCode;

	constructor(code: WsErrorCode, message: string) {
		super(message);
		this.name = "RequestError";
		this.code = code;
	}
}

/** The host's failure code a rejection carries, or `undefined` for any unnamed failure. */
export function wsErrorCode(err: unknown): WsErrorCode | undefined {
	return err instanceof RequestError ? err.code : undefined;
}
