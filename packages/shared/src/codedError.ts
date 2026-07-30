import type { WsErrorCode } from "@thinkrail/contracts";

/**
 * An error that carries a wire {@link WsErrorCode}, so a failure the client must react to *specifically*
 * travels as a name instead of a string a client would have to pattern-match. The host's request handler
 * puts the code on the `{ ok: false }` response; everything else stays an ordinary `Error`.
 *
 * Lives here (not in a feature module) because both ends of the seam need it: the module that *knows* the
 * failure (e.g. `server/src/git` resolving a vanished commit) throws it, and the host reads it — and
 * neither may import the other.
 */
export class CodedError extends Error {
	readonly code: WsErrorCode;

	constructor(code: WsErrorCode, message: string) {
		super(message);
		this.name = "CodedError";
		this.code = code;
	}
}

/** The wire code a thrown value carries, or `undefined` for any ordinary failure. */
export function errorCodeOf(err: unknown): WsErrorCode | undefined {
	return err instanceof CodedError ? err.code : undefined;
}
