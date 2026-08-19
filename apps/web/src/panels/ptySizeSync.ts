export interface PtyGrid {
	cols: number;
	rows: number;
}

export interface PtySizeSync {
	/** Record the size a newly-created PTY already has. */
	acknowledge(size: PtyGrid): void;
	/** Make this the desired grid, sending it when it differs from acknowledged/in-flight work. */
	request(size: PtyGrid): void;
	/** Ignore promise settlements after component teardown. */
	dispose(): void;
}

const sameGrid = (left: PtyGrid | null, right: PtyGrid): boolean =>
	left?.cols === right.cols && left.rows === right.rows;

export interface TerminalRelayoutBound {
	/** Deadline after which startup proceeds without the relayout. */
	timeoutMs: number;
	/** Neutralize the still-pending relayout so a late settlement cannot re-measure a live terminal. */
	onTimeout: () => void;
}

/** Run `start` once the relayout settles or the deadline expires, whichever comes first; expiry fires `onTimeout` before `start`. */
export async function runAfterTerminalRelayout(
	relayout: () => Promise<unknown>,
	start: () => void,
	{ timeoutMs, onTimeout }: TerminalRelayoutBound,
): Promise<void> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timedOut = await Promise.race([
		Promise.resolve()
			.then(relayout)
			.then(
				() => false,
				() => false,
			),
		new Promise<boolean>((resolve) => {
			timer = setTimeout(() => resolve(true), timeoutMs);
		}),
	]);
	clearTimeout(timer);
	if (timedOut) onTimeout();
	start();
}

/**
 * Serializes PTY resizes while keeping desired, in-flight, and host-acknowledged grids distinct.
 *
 * A failed request never advances `acknowledged`, so a later observer/visibility fit of the same grid retries.
 * If layout changes during an in-flight request, only the newest desired grid follows its settlement.
 */
export function createPtySizeSync(send: (size: PtyGrid) => Promise<unknown>): PtySizeSync {
	let desired: PtyGrid | null = null;
	let inFlight: PtyGrid | null = null;
	let acknowledged: PtyGrid | null = null;
	let disposed = false;

	const pump = (): void => {
		if (disposed || inFlight || !desired || sameGrid(acknowledged, desired)) return;
		const sending = desired;
		inFlight = sending;
		void send(sending).then(
			() => {
				if (disposed || inFlight !== sending) return;
				acknowledged = sending;
				inFlight = null;
				pump();
			},
			() => {
				if (disposed || inFlight !== sending) return;
				inFlight = null;
				// Do not hot-loop a host rejection. A superseding layout is distinct work and may proceed now;
				// the same grid retries only when a later fit calls `request` again.
				if (desired && !sameGrid(desired, sending)) pump();
			},
		);
	};

	return {
		acknowledge(size) {
			if (disposed) return;
			acknowledged = size;
		},
		request(size) {
			if (disposed) return;
			desired = size;
			pump();
		},
		dispose() {
			disposed = true;
			desired = null;
			inFlight = null;
		},
	};
}
