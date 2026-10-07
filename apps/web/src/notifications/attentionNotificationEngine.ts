import {
	type AttentionEvent,
	formatNotification,
	type NotificationSpec,
} from "./formatNotification";
import type { NotificationPermissionState } from "./webNotifications";

export type TimerHandle = ReturnType<typeof setTimeout> | number;

export interface AttentionNotificationEngineDeps {
	/** Collection-window length: events accumulate for this long, then flush as one batch. */
	windowMs: number;
	/** Master toggle (Settings → Notifications). */
	isEnabled: () => boolean;
	/** Current browser permission. */
	permission: () => NotificationPermissionState;
	/** Window focus — the sole suppression signal; focused ⇒ never notify. */
	isWindowFocused: () => boolean;
	/** Whether a session is still in needs-attention at flush time (dot still lit). */
	isStillLit: (sessionId: string) => boolean;
	/** Show the composed notification. */
	emit: (spec: NotificationSpec) => void;
	/**
	 * A batch passed every gate except browser permission — prompt the user (in-app preface) once the
	 * caller decides the cadence allows it.
	 */
	onPermissionNeeded: () => void;
	schedule?: (callback: () => void, delay: number) => TimerHandle;
	cancel?: (handle: TimerHandle) => void;
}

export interface AttentionNotificationEngine {
	/** Record one green-dot rising edge; starts the collection window if idle. */
	enqueue: (event: AttentionEvent) => void;
	/** Flush immediately (used by tests and teardown). */
	flushNow: () => void;
	dispose: () => void;
}

/**
 * The queue + collection window + suppression consumer. Pure of the DOM and store: callers inject
 * focus/permission/settings/liveness reads and the emit sink. On flush it keeps the latest event per
 * session, drops focused/already-answered/disabled batches, and either emits or asks for permission.
 */
export function createAttentionNotificationEngine(
	deps: AttentionNotificationEngineDeps,
): AttentionNotificationEngine {
	const schedule = deps.schedule ?? ((callback, delay) => setTimeout(callback, delay));
	const cancel = deps.cancel ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));

	const pending = new Map<string, AttentionEvent>();
	let timer: TimerHandle | null = null;
	let disposed = false;

	const clearTimer = () => {
		if (timer === null) return;
		cancel(timer);
		timer = null;
	};

	const flush = () => {
		clearTimer();
		if (disposed) return;
		const events = [...pending.values()].filter((event) => deps.isStillLit(event.sessionId));
		pending.clear();
		if (events.length === 0) return;
		// Window focused ⇒ the user is in the app and sees the dot; never notify.
		if (deps.isWindowFocused()) return;
		if (!deps.isEnabled()) return;
		if (deps.permission() !== "granted") {
			deps.onPermissionNeeded();
			return;
		}
		const spec = formatNotification(events);
		if (spec) deps.emit(spec);
	};

	return {
		enqueue(event) {
			if (disposed) return;
			pending.set(event.sessionId, event);
			if (timer === null) timer = schedule(flush, deps.windowMs);
		},
		flushNow() {
			flush();
		},
		dispose() {
			disposed = true;
			clearTimer();
			pending.clear();
		},
	};
}
