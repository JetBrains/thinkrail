export interface BackfillQueueOptions {
	readonly concurrency: number;
	readonly run: (key: string) => Promise<unknown>;
	readonly isWanted?: (key: string) => boolean;
}

export interface BackfillQueue {
	readonly schedule: (keys: readonly string[]) => void;
	readonly clearPending: () => void;
}

export function createBackfillQueue(options: BackfillQueueOptions): BackfillQueue {
	const pending: string[] = [];
	const inFlight = new Set<string>();
	const rerun = new Set<string>();
	const wanted = (key: string) => options.isWanted?.(key) ?? true;

	const pump = (): void => {
		while (inFlight.size < options.concurrency) {
			const key = pending.shift();
			if (key === undefined) return;
			if (!wanted(key)) continue;
			inFlight.add(key);
			void options
				.run(key)
				.catch(() => {})
				.finally(() => {
					inFlight.delete(key);
					if (rerun.delete(key) && !pending.includes(key)) pending.push(key);
					pump();
				});
		}
	};

	return {
		schedule(keys) {
			pending.length = 0;
			rerun.clear();
			for (const key of keys) {
				if (inFlight.has(key)) rerun.add(key);
				else if (!pending.includes(key) && wanted(key)) pending.push(key);
			}
			pump();
		},
		clearPending() {
			pending.length = 0;
			rerun.clear();
		},
	};
}
