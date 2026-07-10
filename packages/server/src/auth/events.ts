// The `auth.event` publish seam — `host` wires it to the WS channel (mirrors the terminal/session seams).

import type { AuthEvent } from "@thinkrail/contracts";

export type AuthEventPublisher = (event: AuthEvent) => void;

let publisher: AuthEventPublisher | null = null;

/** Install the server→client push function (host), or a capture function (tests). */
export function setAuthEventPublisher(fn: AuthEventPublisher | null): void {
	publisher = fn;
}

/** Push an auth flow/invalidation frame to every client. A missing publisher is a silent no-op. */
export function publishAuthEvent(event: AuthEvent): void {
	publisher?.(event);
}
