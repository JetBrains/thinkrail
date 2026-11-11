export interface ReconnectLoop {
	/** True while the last attempt's connection is up. */
	readonly open: boolean;
	/** A connection opened outside the loop (the first attempt); resets the backoff. */
	opened(): void;
	/** The connection dropped or an attempt failed: retry after the current backoff. */
	dropped(): void;
	/** Retry at once (the app came back, the network changed); a no-op while open or mid-attempt. */
	now(): void;
	stop(): void;
}

export interface ReconnectLoopOptions {
	/** One attempt; resolves once connected. */
	attempt: () => Promise<void>;
	/** A failure retrying cannot fix ends the loop and reaches `onLost`. */
	isTerminal: (error: unknown) => boolean;
	onLost: (error: unknown) => void;
	/** Every failed attempt that will be retried, for a status line. */
	onRetryFailed?: (error: unknown) => void;
	onOpenChange?: (open: boolean) => void;
	initialBackoffMs?: number;
	maxBackoffMs?: number;
	setTimer?: (run: () => void, ms: number) => unknown;
	clearTimer?: (handle: unknown) => void;
}

/**
 * Keeps a connection coming back: after a drop it retries with doubling backoff, `now()` skips the wait, a
 * terminal failure stops it. One attempt runs at a time.
 */
export function createReconnectLoop(options: ReconnectLoopOptions): ReconnectLoop {
	const initial = options.initialBackoffMs ?? 500;
	const max = options.maxBackoffMs ?? 10_000;
	const setTimer =
		options.setTimer ?? ((run: () => void, ms: number): unknown => setTimeout(run, ms));
	const clearTimer =
		options.clearTimer ??
		((handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>));
	let backoff = initial;
	let timer: unknown = null;
	let attempting = false;
	let open = false;
	let stopped = false;

	const setOpen = (next: boolean): void => {
		if (open === next) return;
		open = next;
		options.onOpenChange?.(next);
	};
	const cancelTimer = (): void => {
		if (timer === null) return;
		clearTimer(timer);
		timer = null;
	};
	const run = (): void => {
		if (stopped || attempting || open) return;
		cancelTimer();
		attempting = true;
		options.attempt().then(
			() => {
				attempting = false;
				if (stopped) return;
				backoff = initial;
				setOpen(true);
			},
			(error: unknown) => {
				attempting = false;
				if (stopped) return;
				if (options.isTerminal(error)) {
					stopped = true;
					options.onLost(error);
					return;
				}
				options.onRetryFailed?.(error);
				schedule();
			},
		);
	};
	const schedule = (): void => {
		if (stopped || attempting || timer !== null) return;
		const delay = backoff;
		backoff = Math.min(backoff * 2, max);
		timer = setTimer(() => {
			timer = null;
			run();
		}, delay);
	};

	return {
		get open() {
			return open;
		},
		opened() {
			backoff = initial;
			setOpen(true);
		},
		dropped() {
			setOpen(false);
			schedule();
		},
		now() {
			if (stopped || open || attempting) return;
			backoff = initial;
			run();
		},
		stop() {
			stopped = true;
			cancelTimer();
		},
	};
}
