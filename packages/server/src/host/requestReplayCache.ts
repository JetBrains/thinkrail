/** A request id may only ever describe one operation during a page identity's lifetime. */
export class RequestReplayConflictError extends Error {
	constructor(id: string) {
		super(`request id "${id}" was reused with a different payload`);
		this.name = "RequestReplayConflictError";
	}
}

/**
 * A replay of a request whose result the host reclaimed under memory pressure. The work ran exactly once and
 * must not run again, so the replay fails instead — a visible error the caller can retry deliberately, rather
 * than a second silent execution of a mutation.
 */
export class RequestReplayReclaimedError extends Error {
	constructor(id: string) {
		super(`request id "${id}" already executed; its result is no longer retained`);
		this.name = "RequestReplayReclaimedError";
	}
}

interface ReplayEntry<T> {
	readonly fingerprint: string;
	/** `null` once {@link RequestReplayCache.prune} reclaimed it: the handler ran, the answer is gone. */
	result: Promise<T> | null;
	settled: boolean;
	weight: number;
}

/**
 * Per-client exactly-once execution for requests replayed after a socket loss.
 *
 * A settled result is retained until the client **acknowledges** it ({@link acknowledge}), because a
 * successful `send` is not delivery: a socket that dies with the reply still in its buffer is
 * indistinguishable from one that flushed it, and the page will replay that id on reconnect. Acknowledgement
 * is the only signal that separates the two, so it — not the ceiling below — is how settled entries normally
 * leave the cache. In-flight entries are never touched at all: that is the interval in which executing a
 * duplicate would be most damaging.
 *
 * The count and serialized-weight ceiling is a memory backstop, not the lifecycle, and it is deliberately
 * unable to cause a duplicate: it reclaims a settled **result** but keeps its **id** as a tombstone, so a
 * later replay fails ({@link RequestReplayReclaimedError}) instead of running the work again. Exactly-once
 * therefore holds no matter how the peer behaves; only the answer can be lost, and only under pressure a
 * client that acknowledges never creates — it frees each result as it reads it, so nothing accumulates to
 * reclaim. A tombstone is an id and a fingerprint — on the order of a hundred bytes against the megabytes of
 * response it replaces — and lives until the page is retired.
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
			if (existing.result === null) throw new RequestReplayReclaimedError(requestId);
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
	 * Free the results a client confirms it has read. An acknowledged id can never be replayed, so the copy
	 * retained for that replay has no reader left; anything still unacknowledged stays, because it may be a
	 * response that died with the socket and is exactly what a reconnect replays.
	 *
	 * Receipts for work still **in flight** are ignored rather than obeyed. A client cannot have read a
	 * response that does not exist yet, so such a receipt is a lie or a bug — and honouring it would drop a
	 * running handler, letting the replay start the second execution this cache exists to prevent. Unknown
	 * ids are likewise ignored.
	 */
	acknowledge(clientKey: string, requestIds: readonly string[]): void {
		const requests = this.clients.get(clientKey);
		if (!requests) return;
		for (const id of requestIds) if (requests.get(id)?.settled) requests.delete(id);
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

	/**
	 * The memory backstop. Every *retained* result it can see is by definition **un**acknowledged — an
	 * acknowledged one was deleted on receipt — so it never reaches a result the client has read, and for a
	 * client that acknowledges there is nothing here to reclaim in the first place.
	 *
	 * What it reclaims is the result, oldest first; the id stays behind as a tombstone so the operation can
	 * still be recognised as already executed. That is the whole point: the bound costs an *answer* under
	 * pressure, never a repeated *execution*. Tombstones are not results and so cost nothing against either
	 * limit — they are freed when the page is retired.
	 */
	private prune(requests: Map<string, ReplayEntry<T>>): void {
		let retainedCount = 0;
		let retainedWeight = 0;
		for (const entry of requests.values()) {
			if (!entry.settled || entry.result === null) continue;
			retainedCount += 1;
			retainedWeight += entry.weight;
		}
		if (
			retainedCount <= this.maxSettledPerClient &&
			retainedWeight <= this.maxSettledWeightPerClient
		) {
			return;
		}

		for (const entry of requests.values()) {
			if (!entry.settled || entry.result === null) continue;
			// Keep at least the newest one, even if that single response exceeds the byte target: the handler
			// already had to materialize it, and retaining one preserves reconnect replay without unbounded count.
			if (retainedCount === 1) return;
			entry.result = null;
			retainedCount -= 1;
			retainedWeight -= entry.weight;
			entry.weight = 0;
			if (
				retainedCount <= this.maxSettledPerClient &&
				retainedWeight <= this.maxSettledWeightPerClient
			) {
				return;
			}
		}
	}
}
