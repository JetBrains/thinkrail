import type { WsErrorCode } from "@thinkrail/contracts";

export class RequestError extends Error {
	readonly code: WsErrorCode;

	constructor(code: WsErrorCode, message: string) {
		super(message);
		this.name = "RequestError";
		this.code = code;
	}
}

export function wsErrorCode(err: unknown): WsErrorCode | undefined {
	return err instanceof RequestError ? err.code : undefined;
}

/** The host did not answer within the request's `timeoutMs`; the request may still complete there. */
export class RequestTimeoutError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "RequestTimeoutError";
	}
}
