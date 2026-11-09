export interface ConnectionLimiter {
	/** Claims a connection slot for an address; false when it already holds the maximum. */
	acquire(address: string): boolean;
	release(address: string): void;
}

export function createConnectionLimiter(maxPerAddress: number): ConnectionLimiter {
	const open = new Map<string, number>();
	return {
		acquire(address) {
			const count = open.get(address) ?? 0;
			if (count >= maxPerAddress) return false;
			open.set(address, count + 1);
			return true;
		},
		release(address) {
			const count = (open.get(address) ?? 0) - 1;
			if (count > 0) open.set(address, count);
			else open.delete(address);
		},
	};
}

export interface RateLimiter {
	/** Spends one message; false when the connection is over its rate. */
	take(now?: number): boolean;
}

/** A token bucket: `burst` messages at once, refilled at `perSecond`. */
export function createRateLimiter(perSecond: number, burst: number): RateLimiter {
	let tokens = burst;
	let last = Date.now();
	return {
		take(now = Date.now()) {
			tokens = Math.min(burst, tokens + ((now - last) / 1000) * perSecond);
			last = now;
			if (tokens < 1) return false;
			tokens -= 1;
			return true;
		},
	};
}
