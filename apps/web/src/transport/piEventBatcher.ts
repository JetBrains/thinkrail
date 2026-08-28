import type { SessionEventPayload, WsServerMessage } from "@thinkrail/contracts";
import { WS_CHANNELS } from "@thinkrail/contracts";

const DEFAULT_DELAY_MS = 32;
const DEFAULT_MAX_BATCH_SIZE = 128;

type CancelScheduledFlush = () => void;
type ScheduleFlush = (flush: () => void) => CancelScheduledFlush;

interface PiEventBatcherOptions {
	maxBatchSize?: number;
	schedule?: ScheduleFlush;
}

export interface PiEventBatcher {
	enqueue: (payload: SessionEventPayload) => void;
	flush: () => void;
	dispose: () => void;
}

function defaultSchedule(flush: () => void): CancelScheduledFlush {
	const timer = setTimeout(flush, DEFAULT_DELAY_MS);
	return () => clearTimeout(timer);
}

export function createPiEventBatcher(
	deliver: (payloads: readonly SessionEventPayload[]) => void,
	options: PiEventBatcherOptions = {},
): PiEventBatcher {
	const maxBatchSize = options.maxBatchSize ?? DEFAULT_MAX_BATCH_SIZE;
	const schedule = options.schedule ?? defaultSchedule;
	let queued: SessionEventPayload[] = [];
	let cancelScheduled: CancelScheduledFlush | null = null;
	let disposed = false;

	const flush = () => {
		cancelScheduled?.();
		cancelScheduled = null;
		if (disposed || queued.length === 0) return;
		const payloads = queued;
		queued = [];
		deliver(payloads);
	};

	return {
		enqueue: (payload) => {
			if (disposed) return;
			queued.push(payload);
			if (queued.length >= maxBatchSize) {
				flush();
				return;
			}
			cancelScheduled ??= schedule(flush);
		},
		flush,
		dispose: () => {
			disposed = true;
			queued = [];
			cancelScheduled?.();
			cancelScheduled = null;
		},
	};
}

export function shouldFlushPiEventsBefore(message: WsServerMessage): boolean {
	return !("channel" in message) || message.channel !== WS_CHANNELS.piEvent;
}
