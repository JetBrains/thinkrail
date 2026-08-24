export interface PtyGrid {
	cols: number;
	rows: number;
}

export interface PtySizeSync {
	acknowledge(size: PtyGrid): void;
	request(size: PtyGrid): void;
	dispose(): void;
}

const sameGrid = (left: PtyGrid | null, right: PtyGrid): boolean =>
	left?.cols === right.cols && left.rows === right.rows;

export interface TerminalRelayoutBound {
	timeoutMs: number;
	onTimeout: () => void;
}

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
