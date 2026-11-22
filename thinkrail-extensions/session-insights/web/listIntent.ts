export type ListTab = "sessions" | "days" | "insights";

export type InsightsSection = "findings" | "usage" | "hotspots" | "sequences" | "ab";

export interface ListIntent {
	tab: ListTab;
	section?: InsightsSection;
}

type Listener = (intent: ListIntent) => void;

let pending: ListIntent | null = null;
const listeners = new Set<Listener>();

/**
 * Asks the session list to show a tab (and an Insights section): the list tab already open hears it now,
 * one opening next reads it on mount. The panels share this module (one web half), as with `focus.ts`.
 */
export function requestListView(intent: ListIntent): void {
	pending = intent;
	for (const listener of listeners) listener(intent);
}

/** The view the list was asked to show, if any (read without consuming it). */
export function pendingListView(): ListIntent | null {
	return pending;
}

/** Forgets the request once the list has shown it. */
export function settleListView(intent: ListIntent): void {
	if (pending === intent) pending = null;
}

export function onListView(listener: Listener): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}
