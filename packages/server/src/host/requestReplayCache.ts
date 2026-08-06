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

	clearClient(clientKey: string): void {
		this.clients.delete(clientKey);
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
		// `clearClient` may have retired this page while its handler was still completing. Never resurrect it.
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
