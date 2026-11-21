const resets = new Set<() => void>();
let resetting = false;

export function onHostReset(reset: () => void): () => void {
	resets.add(reset);
	return () => {
		resets.delete(reset);
	};
}

export function isHostResetting(): boolean {
	return resetting;
}

export function resetHost(resetStore: () => void): void {
	resetting = true;
	try {
		resetStore();
	} finally {
		resetting = false;
	}
	for (const reset of resets) reset();
}
