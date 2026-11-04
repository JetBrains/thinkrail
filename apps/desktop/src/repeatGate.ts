// A held non-modifier key auto-repeats on macOS and therefore keeps producing
// key-down events; this poll interval is short so release is prompt.
const REPEAT_GATE_POLL_MS = 40;
// CGEventSourceKeyState can read "a key is down" forever after a synthetic
// input stack (KVM-over-IP, remote desktop) loses the key-up packet. A key
// that is genuinely held and repeating generates key-down events
// continuously, so "state says down but no key-down event has arrived for
// this long" is the signature of a stale, phantom state — release the latch
// then. This keeps the desktop guarantee that a held key never fires a
// command twice: real repeats keep the events (and the latch) flowing (#1199).
const REPEAT_GATE_STALE_KEY_MS = 750;

export interface RepeatGateDependencies {
	isKeyDown(): boolean | null;
	/** Seconds since the last key-down event, or null when unreadable. */
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
		// Unreadable freshness falls back to trusting the state, matching the
		// gate's behavior when key state itself is unreadable.
		return since === null || since * 1000 < REPEAT_GATE_STALE_KEY_MS;
	}
	return (forward: () => void) => {
		if (stopPolling) return;
		forward();
		if (dependencies.isKeyDown() !== true) return;
		stopPolling = dependencies.every(unlatchOnStaleOrRelease, REPEAT_GATE_POLL_MS);
	};
}
