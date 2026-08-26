export class Semaphore {
	private readonly waiters: Array<() => void> = [];
	private available: number;

	constructor(slots: number) {
		if (!Number.isInteger(slots) || slots < 1) {
			throw new Error(`Semaphore slots must be a positive integer, got ${slots}`);
		}
		this.available = slots;
	}

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
