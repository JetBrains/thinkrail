import { useSyncExternalStore } from "react";

const NOW_TICK_MS = 30_000;
const listeners = new Set<() => void>();
let now = Date.now();
let ticker: ReturnType<typeof setInterval> | null = null;

function subscribe(listener: () => void): () => void {
	listeners.add(listener);
	if (ticker === null) {
		ticker = setInterval(() => {
			now = Date.now();
			for (const notify of listeners) notify();
		}, NOW_TICK_MS);
	}
	return () => {
		listeners.delete(listener);
		if (listeners.size === 0 && ticker !== null) {
			clearInterval(ticker);
			ticker = null;
		}
	};
}

function readNow(): number {
	if (Date.now() - now >= NOW_TICK_MS) now = Date.now();
	return now;
}

export function useNow(): number {
	return useSyncExternalStore(subscribe, readNow);
}
