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
