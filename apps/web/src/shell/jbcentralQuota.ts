import type { JbcentralQuotaSnapshot } from "@thinkrail/contracts";

export type TimerHandle = ReturnType<typeof setTimeout> | number;

export interface JbcentralQuotaPollingOptions {
	intervalMs: number;
	request: (force: boolean) => Promise<JbcentralQuotaSnapshot>;
	onSnapshot: (snapshot: JbcentralQuotaSnapshot) => void;
	onError: () => void;
	schedule?: (callback: () => void, delay: number) => TimerHandle;
	cancel?: (handle: TimerHandle) => void;
}

export interface JbcentralQuotaPolling {
	retry(): void;
	stop(): void;
}

export function formatJbcentralQuota(remaining: number, total: number, locale?: string): string {
	const formatter = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 });
	return `${formatter.format(remaining)} / ${formatter.format(total)}`;
}

export function startJbcentralQuotaPolling({
	intervalMs,
	request,
	onSnapshot,
	onError,
	schedule = (callback, delay) => setTimeout(callback, delay),
	cancel = (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
}: JbcentralQuotaPollingOptions): JbcentralQuotaPolling {
	let stopped = false;
	let running = false;
	let queuedForce = false;
	let timer: TimerHandle | null = null;

	const clearTimer = () => {
		if (timer === null) return;
		cancel(timer);
		timer = null;
	};

	const run = async (force: boolean): Promise<void> => {
		if (stopped) return;
		if (running) {
			queuedForce ||= force;
			return;
		}
		clearTimer();
		running = true;
		let continuePolling = true;
		try {
			const snapshot = await request(force);
			if (stopped) return;
			onSnapshot(snapshot);
			continuePolling = snapshot.state !== "hidden";
		} catch {
			if (!stopped) onError();
		} finally {
			running = false;
			if (!stopped) {
				if (queuedForce) {
					queuedForce = false;
					void run(true);
				} else if (continuePolling) {
					timer = schedule(() => void run(false), intervalMs);
				}
			}
		}
	};

	void run(false);
	return {
		retry() {
			if (stopped) return;
			clearTimer();
			void run(true);
		},
		stop() {
			stopped = true;
			queuedForce = false;
			clearTimer();
		},
	};
}
