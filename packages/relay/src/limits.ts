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
export function createRateLimiter(
	perSecond: number,
	burst: number,
	start: number = Date.now(),
): RateLimiter {
	let tokens = burst;
	let last = start;
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

export interface KeyedRateLimiter {
	/** Spends one token from `key`'s bucket; false when that key is over its rate. */
	take(key: string, now?: number): boolean;
}

/**
 * One token bucket per key (a client address). Past `maxKeys` the oldest bucket is dropped, so memory stays
 * bounded; a dropped key starts again at a full burst.
 */
export function createKeyedRateLimiter(
	perSecond: number,
	burst: number,
	maxKeys = 10_000,
): KeyedRateLimiter {
	const buckets = new Map<string, RateLimiter>();
	return {
		take(key, now = Date.now()) {
			let bucket = buckets.get(key);
			if (!bucket) {
				if (buckets.size >= maxKeys) {
					const oldest = buckets.keys().next().value;
					if (oldest !== undefined) buckets.delete(oldest);
				}
				bucket = createRateLimiter(perSecond, burst, now);
				buckets.set(key, bucket);
			}
			return bucket.take(now);
		},
	};
}
