import type { WsErrorCode, WsErrorParams } from "@thinkrail/contracts";

export class CodedError extends Error {
	readonly code: WsErrorCode;

	constructor(
		code: WsErrorCode,
		message: string,
		readonly errorParams?: WsErrorParams,
	) {
		super(message);
		this.name = "CodedError";
		this.code = code;
	}
}

export function errorCodeOf(err: unknown): WsErrorCode | undefined {
	return err instanceof CodedError ? err.code : undefined;
}

export function errorParamsOf(err: unknown): WsErrorParams | undefined {
	return err instanceof CodedError ? err.errorParams : undefined;
}
