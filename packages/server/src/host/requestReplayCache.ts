/** A request id may only ever describe one operation during a page identity's lifetime. */
export class RequestReplayConflictError extends Error {
	constructor(id: string) {
		super(`request id "${id}" was reused with a different payload`);
		this.name = "RequestReplayConflictError";
	}
}

interface ReplayEntry<T> {
	readonly fingerprint: string;
	readonly result: Promise<T>;
	settled: boolean;
	weight: number;
}

/**
 * Per-client exactly-once execution for requests replayed after a socket loss.
 *
 * In-flight entries are never evicted: that is the interval in which executing a duplicate would be most
 * damaging. Settled entries are insertion-ordered and bounded by count and serialized-result weight; the
 * production client never replays a request after receiving its response, so the window only needs to cover
 * unresolved reconnects.
 */
export class RequestReplayCache<T> {
	private readonly clients = new Map<string, Map<string, ReplayEntry<T>>>();

	constructor(
		private readonly maxSettledPerClient = 512,
		private readonly maxSettledWeightPerClient = 16 * 1024 * 1024,
	) {}

	run(
		clientKey: string,
		requestId: string,
		fingerprint: string,
		execute: () => Promise<T> | T,
	): Promise<T> {
		let requests = this.clients.get(clientKey);
		if (!requests) {
			requests = new Map();
			this.clients.set(clientKey, requests);
		}

		const existing = requests.get(requestId);
		if (existing) {
			if (existing.fingerprint !== fingerprint) throw new RequestReplayConflictError(requestId);
			return existing.result;
		}

		// Install the promise before invoking the handler on the next microtask. A concurrent duplicate can
		// therefore only observe this entry; it can never start a second execution between lookup and insert.
		const result = Promise.resolve().then(execute);
		const entry: ReplayEntry<T> = { fingerprint, result, settled: false, weight: 0 };
		requests.set(requestId, entry);
		result.then(
			(value) => this.markSettled(clientKey, requests, entry, this.resultWeight(value)),
			() => this.markSettled(clientKey, requests, entry, 1),
		);
		return result;
	}

	/**
	 * Retire a page's namespace once that page is gone for good, freeing its retained responses. Returns
	 * whether it is gone: while a request is still **in flight** this clears nothing and answers `false`, so
	 * the caller retires it later.
	 *
	 * An unresolved request is proof the page may still return — it is precisely the frame a reconnect
	 * replays, and the client holds that frame until *its own* deadline, which for the folder picker is 30
	 * minutes of a human deciding. Dropping the entry mid-handler would let the replay start a second
	 * execution of an operation the first one has not even finished, which is the duplicate this cache
	 * exists to prevent. Retiring is all-or-nothing for the same reason: that page's settled results are
	 * still replay-addressable to it, and they are already bounded below.
	 */
	clearClient(clientKey: string): boolean {
		const requests = this.clients.get(clientKey);
		if (!requests) return true;
		for (const entry of requests.values()) if (!entry.settled) return false;
		this.clients.delete(clientKey);
		return true;
	}

	clear(): void {
		this.clients.clear();
	}

	private markSettled(
		clientKey: string,
		requests: Map<string, ReplayEntry<T>>,
		entry: ReplayEntry<T>,
		weight: number,
	): void {
		// The host may have shut the cache down (`clear`) while this handler was still completing — `clearClient`
		// cannot, it declines while anything is in flight. Either way: never resurrect a dropped namespace.
		if (this.clients.get(clientKey) !== requests) return;
		entry.settled = true;
		entry.weight = weight;
		this.prune(requests);
	}

	private resultWeight(value: T): number {
		// Production values are serialized response strings; keeping 512 large file-read responses would make a
		// count-only "bound" meaningless. Generic test values still cost one entry.
		return typeof value === "string" ? value.length : 1;
	}

	private prune(requests: Map<string, ReplayEntry<T>>): void {
		let settledCount = 0;
		let settledWeight = 0;
		for (const entry of requests.values()) {
			if (!entry.settled) continue;
			settledCount += 1;
			settledWeight += entry.weight;
		}
		if (
			settledCount <= this.maxSettledPerClient &&
			settledWeight <= this.maxSettledWeightPerClient
		) {
			return;
		}

		for (const [id, entry] of requests) {
			if (!entry.settled) continue;
			// Keep at least the newest one, even if that single response exceeds the byte target: the handler
			// already had to materialize it, and retaining one preserves reconnect replay without unbounded count.
			if (settledCount === 1) return;
			requests.delete(id);
			settledCount -= 1;
			settledWeight -= entry.weight;
			if (
				settledCount <= this.maxSettledPerClient &&
				settledWeight <= this.maxSettledWeightPerClient
			) {
				return;
			}
		}
	}
}
