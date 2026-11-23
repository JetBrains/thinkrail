/** Re-ask after 1 s, then 2 s, then every 5 s while the answer is still pending. */
export const BACKOFF_MS = [1000, 2000, 5000] as const;

function hidden(): boolean {
	return typeof document !== "undefined" && document.hidden;
}

export interface Retry {
	/** Asks again after the next backoff step, once the document is visible. */
	again(): void;
	/** Cancels the waiting ask and stops listening for visibility. */
	stop(): void;
}

/**
 * Re-asks with the backoff, only while the document is visible: an ask due in a hidden tab waits for
 * the tab's return. Nothing listens until the first `again`.
 */
export function retryWithBackoff(ask: () => void): Retry {
	let timer: ReturnType<typeof setTimeout> | undefined;
	let polls = 0;
	let due = false;
	let listening = false;
	const poll = () => {
		timer = undefined;
		if (hidden()) due = true;
		else ask();
	};
	const onVisibility = () => {
		if (!due || hidden()) return;
		due = false;
		ask();
	};
	return {
		again() {
			if (!listening && typeof document !== "undefined") {
				document.addEventListener("visibilitychange", onVisibility);
				listening = true;
			}
			const wait = BACKOFF_MS[Math.min(polls, BACKOFF_MS.length - 1)];
			polls += 1;
			clearTimeout(timer);
			timer = setTimeout(poll, wait);
		},
		stop() {
			clearTimeout(timer);
			timer = undefined;
			due = false;
			if (listening) document.removeEventListener("visibilitychange", onVisibility);
			listening = false;
		},
	};
}
