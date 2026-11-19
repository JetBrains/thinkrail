type Listener = (sessionId: string) => void;

const pending = new Map<string, string>();
const listeners = new Set<Listener>();

/**
 * Asks a session's analysis to open on an event: the tab already open hears it now, a tab opening next
 * reads it on mount. Both panels share this module (one web half), so nothing crosses the host.
 */
export function requestSessionFocus(sessionId: string, eventId: string): void {
	pending.set(sessionId, eventId);
	for (const listener of listeners) listener(sessionId);
}

/** The event a session's analysis was asked to open on, if any (read without consuming it). */
export function pendingSessionFocus(sessionId: string): string | null {
	return pending.get(sessionId) ?? null;
}

/** Forgets the request once a panel has shown it. */
export function settleSessionFocus(sessionId: string, eventId: string): void {
	if (pending.get(sessionId) === eventId) pending.delete(sessionId);
}

export function onSessionFocus(listener: Listener): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}
