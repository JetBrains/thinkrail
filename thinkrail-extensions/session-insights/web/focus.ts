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

/**
 * Takes a session's focus requests for the tab showing it: the one pending now is settled (the tab
 * opened on it), and each later one is settled and handed to `onFocus`.
 */
export function followSessionFocus(
	sessionId: string,
	onFocus: (eventId: string) => void,
): () => void {
	const initial = pendingSessionFocus(sessionId);
	if (initial) settleSessionFocus(sessionId, initial);
	const listener: Listener = (target) => {
		const eventId = target === sessionId ? pendingSessionFocus(sessionId) : null;
		if (!eventId) return;
		settleSessionFocus(sessionId, eventId);
		onFocus(eventId);
	};
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}
