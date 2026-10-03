const REPEAT_GATE_POLL_MS = 40;

export interface RepeatGateDependencies {
	isKeyDown(): boolean | null;
	every(callback: () => void, ms: number): () => void;
}

export function createRepeatGate(dependencies: RepeatGateDependencies) {
	let stopPolling: (() => void) | null = null;
	function unlatchOnRelease() {
		if (dependencies.isKeyDown() === true) return;
		stopPolling?.();
		stopPolling = null;
	}
	return (forward: () => void) => {
		if (stopPolling) return;
		forward();
		if (dependencies.isKeyDown() !== true) return;
		stopPolling = dependencies.every(unlatchOnRelease, REPEAT_GATE_POLL_MS);
	};
}
