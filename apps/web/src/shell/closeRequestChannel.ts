const listeners = new Set<() => void>();

export function requestClose() {
	for (const listener of listeners) listener();
}

export function subscribeCloseRequest(listener: () => void) {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}
