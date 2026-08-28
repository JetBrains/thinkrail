export const SUBAGENT_TRANSCRIPT_POLL_MS = 2_500;

const TRANSIENT_RETRY_DELAYS_MS = [500, 1_500, 5_000] as const;

export interface TranscriptPollScheduler {
	set(callback: () => void, delayMs: number): unknown;
	clear(timer: unknown): void;
}

interface StartTranscriptPollingOptions<T> {
	read: () => Promise<T>;
	isLive: (result: T) => boolean;
	isPermanentError: (error: unknown) => boolean;
	onResult: (result: T) => void;
	onError: (error: unknown) => void;
	scheduler?: TranscriptPollScheduler;
}

const defaultScheduler: TranscriptPollScheduler = {
	set: (callback, delayMs) => setTimeout(callback, delayMs),
	clear: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
};

export function subagentTranscriptRetryDelay(failureCount: number): number {
	const index = Math.max(0, Math.min(failureCount - 1, TRANSIENT_RETRY_DELAYS_MS.length - 1));
	return TRANSIENT_RETRY_DELAYS_MS[index] ?? TRANSIENT_RETRY_DELAYS_MS[0];
}

export function startSubagentTranscriptPolling<T>(
	options: StartTranscriptPollingOptions<T>,
): () => void {
	const scheduler = options.scheduler ?? defaultScheduler;
	let active = true;
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
		let result: T;
		try {
			result = await options.read();
		} catch (error) {
			if (!active) return;
			options.onError(error);
			if (options.isPermanentError(error)) return;
			failureCount++;
			schedule(subagentTranscriptRetryDelay(failureCount));
			return;
		}
		if (!active) return;
		failureCount = 0;
		options.onResult(result);
		if (options.isLive(result)) schedule(SUBAGENT_TRANSCRIPT_POLL_MS);
	};

	void poll();
	return () => {
		active = false;
		if (timer !== undefined) scheduler.clear(timer);
	};
}
