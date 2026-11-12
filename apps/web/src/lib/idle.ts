export function whenIdle(
	task: () => void,
	{ timeout, fallbackDelay }: { timeout: number; fallbackDelay: number },
): () => void {
	if (typeof globalThis.requestIdleCallback === "function") {
		const handle = globalThis.requestIdleCallback(task, { timeout });
		return () => globalThis.cancelIdleCallback(handle);
	}
	const handle = setTimeout(task, fallbackDelay);
	return () => clearTimeout(handle);
}

export interface PageActivity {
	active(): boolean;
	subscribe(onChange: () => void): () => void;
}

const browserPageActivity: PageActivity = {
	active: () => document.visibilityState !== "hidden" && navigator.onLine,
	subscribe(onChange) {
		document.addEventListener("visibilitychange", onChange);
		window.addEventListener("online", onChange);
		return () => {
			document.removeEventListener("visibilitychange", onChange);
			window.removeEventListener("online", onChange);
		};
	},
};

export function whenPageActive(
	schedule: (run: () => void) => () => void,
	task: () => void,
	activity: PageActivity = browserPageActivity,
): () => void {
	let finished = false;
	let cancelScheduled: (() => void) | null = null;
	let unsubscribe = () => {};
	const attempt = () => {
		if (finished || cancelScheduled || !activity.active()) return;
		unsubscribe();
		cancelScheduled = schedule(run);
	};
	const wait = () => {
		unsubscribe = activity.subscribe(attempt);
		attempt();
	};
	function run() {
		cancelScheduled = null;
		if (!activity.active()) {
			wait();
			return;
		}
		finished = true;
		task();
	}
	wait();
	return () => {
		finished = true;
		unsubscribe();
		cancelScheduled?.();
	};
}
