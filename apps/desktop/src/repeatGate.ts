const REPEAT_GATE_POLL_MS = 40;
const REPEAT_GATE_STALE_KEY_MS = 2500;

export interface RepeatGateDependencies {
	isKeyDown(): boolean | null;
	sinceKeyDown(): number | null;
	every(callback: () => void, ms: number): () => void;
}

export function createRepeatGate(dependencies: RepeatGateDependencies) {
	let stopPolling: (() => void) | null = null;
	function unlatchOnStaleOrRelease() {
		if (dependencies.isKeyDown() === true && isLiveKeyDown()) return;
		stopPolling?.();
		stopPolling = null;
	}
	function isLiveKeyDown(): boolean {
		const since = dependencies.sinceKeyDown();
		return since === null || since * 1000 < REPEAT_GATE_STALE_KEY_MS;
	}
	return (forward: () => void) => {
		if (stopPolling) return;
		forward();
		if (dependencies.isKeyDown() !== true) return;
		stopPolling = dependencies.every(unlatchOnStaleOrRelease, REPEAT_GATE_POLL_MS);
	};
}
