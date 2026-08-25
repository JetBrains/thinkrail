// A minimal FIFO counting semaphore — the per-parent run pacer. Resource governance, not
// correctness: each child is a full LLM session, so unbounded spawn multiplies token spend,
// provider 429 pressure, and load on the one shared event loop.

export class Semaphore {
	private readonly waiters: Array<() => void> = [];
	private available: number;

	constructor(slots: number) {
		if (!Number.isInteger(slots) || slots < 1) {
			throw new Error(`Semaphore slots must be a positive integer, got ${slots}`);
		}
		this.available = slots;
	}

	/** Resolves with the release function once a slot is free. Strictly FIFO. */
	acquire(): Promise<() => void> {
		return new Promise((resolve) => {
			const grant = () => {
				let released = false;
				resolve(() => {
					if (released) return;
					released = true;
					this.release();
				});
			};
			if (this.available > 0) {
				this.available--;
				grant();
			} else {
				this.waiters.push(() => {
					// The slot passes directly to the next waiter — `available` stays 0.
					grant();
				});
			}
		});
	}

	private release(): void {
		const next = this.waiters.shift();
		if (next) next();
		else this.available++;
	}
}
