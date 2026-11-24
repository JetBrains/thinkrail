export interface SingleFlight {
	run: (task: () => unknown) => void;
	stop: () => void;
	isStopped: () => boolean;
}

export function createSingleFlight(): SingleFlight {
	let busy = false;
	let stopped = false;
	let pending: (() => unknown) | null = null;
	const start = (task: () => unknown) => {
		busy = true;
		void new Promise((resolve) => resolve(task())).then(settle, settle);
	};
	const settle = () => {
		busy = false;
		const next = pending;
		pending = null;
		if (next && !stopped) start(next);
	};
	return {
		run: (task) => {
			if (stopped) return;
			if (busy) pending = task;
			else start(task);
		},
		stop: () => {
			stopped = true;
			pending = null;
		},
		isStopped: () => stopped,
	};
}

/**
 * At most one task per key: a call while that key's task is in flight is dropped, so a second click cannot
 * send it twice. `onBusy` hears the keys in flight after every start and settle.
 */
export function createKeyedFlight<K>(
	onBusy: (busy: ReadonlySet<K>) => void = () => {},
): (key: K, task: () => Promise<unknown>) => void {
	const busy = new Set<K>();
	return (key, task) => {
		if (busy.has(key)) return;
		busy.add(key);
		onBusy(new Set(busy));
		const settle = () => {
			busy.delete(key);
			onBusy(new Set(busy));
		};
		void task().then(settle, settle);
	};
}
