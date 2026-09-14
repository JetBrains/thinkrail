export const DETAIL_POLL_MS = 2_500;

const TRANSIENT_RETRY_DELAYS_MS = [500, 1_500, 5_000] as const;

export interface DetailPollScheduler {
	set(callback: () => void, delayMs: number): unknown;
	clear(timer: unknown): void;
}

interface StartDetailPollingOptions<T> {
	read: () => Promise<T>;
	isLive: (result: T) => boolean;
	isPermanentError: (error: unknown) => boolean;
	onResult: (result: T) => void;
	onError: (error: unknown) => void;
	scheduler?: DetailPollScheduler;
}

const defaultScheduler: DetailPollScheduler = {
	set: (callback, delayMs) => setTimeout(callback, delayMs),
	clear: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
};

export function detailRetryDelay(failureCount: number): number {
	const index = Math.max(0, Math.min(failureCount - 1, TRANSIENT_RETRY_DELAYS_MS.length - 1));
	return TRANSIENT_RETRY_DELAYS_MS[index] ?? TRANSIENT_RETRY_DELAYS_MS[0];
}

export function startDetailPolling<T>(options: StartDetailPollingOptions<T>) {
	const scheduler = options.scheduler ?? defaultScheduler;
	let active = true;
	let inFlight = false;
	let settled = false;
	let timer: unknown;
	let failureCount = 0;

	const schedule = (delayMs: number) => {
		if (!active) return;
		timer = scheduler.set(() => {
			timer = undefined;
			void poll();
		}, delayMs);
	};

	const poll = async () => {
		if (!active || inFlight || settled) return;
		inFlight = true;
		let result: T;
		try {
			result = await options.read();
		} catch (error) {
			inFlight = false;
			if (!active) return;
			options.onError(error);
			if (options.isPermanentError(error)) {
				settled = true;
				return;
			}
			failureCount++;
			schedule(detailRetryDelay(failureCount));
			return;
		}
		inFlight = false;
		if (!active) return;
		failureCount = 0;
		options.onResult(result);
		if (options.isLive(result)) schedule(DETAIL_POLL_MS);
		else settled = true;
	};

	void poll();
	return {
		dispose: () => {
			active = false;
			if (timer !== undefined) scheduler.clear(timer);
		},
		refresh: () => {
			if (timer !== undefined) scheduler.clear(timer);
			timer = undefined;
			void poll();
		},
	};
}
