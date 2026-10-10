export function assertSlots(slots: number): void {
	if (!Number.isInteger(slots) || slots < 1) {
		throw new Error(`Semaphore slots must be a positive integer, got ${slots}`);
	}
}

export class Semaphore {
	private readonly waiters: Array<() => void> = [];
	private slots: number;
	private inUse = 0;

	constructor(slots: number) {
		assertSlots(slots);
		this.slots = slots;
	}

	resize(slots: number): void {
		assertSlots(slots);
		this.slots = slots;
		this.drain();
	}

	acquire(): Promise<() => void> {
		return new Promise((resolve) => {
			this.waiters.push(() => {
				this.inUse++;
				let released = false;
				resolve(() => {
					if (released) return;
					released = true;
					this.inUse--;
					this.drain();
				});
			});
			this.drain();
		});
	}

	private drain(): void {
		while (this.inUse < this.slots) {
			const next = this.waiters.shift();
			if (!next) return;
			next();
		}
	}
}
