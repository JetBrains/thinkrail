import type { WsErrorCode, WsErrorParams } from "@thinkrail/contracts";

export class RequestError extends Error {
	readonly code: WsErrorCode;

	constructor(
		code: WsErrorCode,
		message: string,
		readonly errorParams?: WsErrorParams,
	) {
		super(message);
		this.name = "RequestError";
		this.code = code;
	}
}

export function wsErrorCode(err: unknown): WsErrorCode | undefined {
	return err instanceof RequestError ? err.code : undefined;
}
