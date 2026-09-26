const assertSlots = (slots: number) => {
	if (!Number.isInteger(slots) || slots < 1) {
		throw new Error(`Semaphore slots must be a positive integer, got ${slots}`);
	}
};

export class Semaphore {
	private readonly waiters: Array<() => void> = [];
	private available: number;
	private slots: number;

	constructor(slots: number) {
		assertSlots(slots);
		this.slots = slots;
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

	resize(slots: number): void {
		assertSlots(slots);
		this.available += slots - this.slots;
		this.slots = slots;
		while (this.available > 0) {
			const next = this.waiters.shift();
			if (!next) break;
			this.available--;
			next();
		}
	}

	private release(): void {
		if (this.available < 0) {
			this.available++;
			return;
		}
		const next = this.waiters.shift();
		if (next) next();
		else this.available++;
	}
}
