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
	start: () => () => void,
	activity: PageActivity = browserPageActivity,
): () => void {
	let stop: (() => void) | null = null;
	let unsubscribe = () => {};
	const attempt = () => {
		if (stop || !activity.active()) return;
		unsubscribe();
		stop = start();
	};
	unsubscribe = activity.subscribe(attempt);
	attempt();
	return () => {
		unsubscribe();
		stop?.();
	};
}
