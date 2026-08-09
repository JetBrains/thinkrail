/** A request id may only ever describe one operation during a page identity's lifetime. */
export class RequestReplayConflictError extends Error {
	constructor(id: string) {
		super(`request id "${id}" was reused with a different payload`);
		this.name = "RequestReplayConflictError";
	}
}

/**
 * A **new** request refused because the client's replay namespace is full.
 *
 * The alternatives are worse in both directions: evicting a retained result would let its replay execute the
 * work a second time, and admitting without limit would let one page grow the host's memory without bound.
 * Refusing an operation that has *not yet run* costs neither — the client gets a visible failure for something
 * that definitely did not happen, and every id already in the namespace stays replayable.
 */
export class RequestReplayOverflowError extends Error {
	constructor(clientKey: string) {
		super(
			`replay namespace for client "${clientKey}" is full: unacknowledged results must be read first`,
		);
		this.name = "RequestReplayOverflowError";
	}
}

interface ReplayEntry<T> {
	readonly fingerprint: string;
	readonly result: Promise<T>;
	settled: boolean;
	weight: number;
}

interface ClientNamespace<T> {
	readonly requests: Map<string, ReplayEntry<T>>;
	/** Running sum of the settled entries' weight, kept incrementally so admission stays O(1). */
	weight: number;
}

/**
 * Per-client exactly-once execution for requests replayed after a socket loss.
 *
 * **Nothing here is ever evicted.** A result leaves only when the client proves it no longer needs it, because
 * a successful `send` is not delivery: a socket that dies with a reply still in its buffer is indistinguishable
 * from one that flushed it, so any result dropped on the host's own initiative may be exactly the one the page
 * is about to replay for. There are three such proofs, and memory is bounded by refusing new work rather than
 * by discarding old answers:
 *
 * - {@link acknowledge} — the client names responses it has read. The steady-state path while connected.
 * - {@link retain} — on reconnect the client names the ids it still considers unresolved, and everything else
 *   settled is freed. This is the self-healing one: receipts are best-effort (an ack can die in a socket buffer
 *   exactly like a response can), and rather than track and retransmit them, each reconnect simply restates the
 *   whole truth. So a lost receipt costs one entry until the next reconnect, not forever.
 * - {@link clearClient} — the page is gone for good and the namespace goes with it.
 *
 * In-flight entries are exempt from all three: a client cannot have read a response that does not exist yet, and
 * dropping a running handler is precisely the duplicate this cache exists to prevent.
 */
export class RequestReplayCache<T> {
	private readonly clients = new Map<string, ClientNamespace<T>>();

	constructor(
		private readonly maxRequestsPerClient = 512,
		private readonly maxWeightPerClient = 16 * 1024 * 1024,
	) {}

	run(
		clientKey: string,
		requestId: string,
		fingerprint: string,
		execute: () => Promise<T> | T,
	): Promise<T> {
		let namespace = this.clients.get(clientKey);
		if (!namespace) {
			namespace = { requests: new Map(), weight: 0 };
			this.clients.set(clientKey, namespace);
		}
		const requests = namespace.requests;

		const existing = requests.get(requestId);
		if (existing) {
			if (existing.fingerprint !== fingerprint) throw new RequestReplayConflictError(requestId);
			return existing.result;
		}

		// Admission control, and the only bound there is. It gates **new** ids only: a replay of an id already
		// here was answered above, so a full namespace can still finish everything it owes — it just stops
		// taking on more until the client reads what is waiting for it.
		if (requests.size >= this.maxRequestsPerClient || namespace.weight >= this.maxWeightPerClient) {
			throw new RequestReplayOverflowError(clientKey);
		}

		// Install the promise before invoking the handler on the next microtask. A concurrent duplicate can
		// therefore only observe this entry; it can never start a second execution between lookup and insert.
		const result = Promise.resolve().then(execute);
		const entry: ReplayEntry<T> = { fingerprint, result, settled: false, weight: 0 };
		requests.set(requestId, entry);
		result.then(
			(value) => this.markSettled(clientKey, namespace, entry, this.resultWeight(value)),
			() => this.markSettled(clientKey, namespace, entry, 1),
		);
		return result;
	}

	/**
	 * Free the results a client confirms it has read. An acknowledged id can never be replayed, so the copy
	 * retained for that replay has no reader left.
	 */
	acknowledge(clientKey: string, requestIds: readonly string[]): void {
		const namespace = this.clients.get(clientKey);
		if (!namespace) return;
		for (const id of requestIds) this.free(namespace, id);
	}

	/**
	 * Reconcile against the client's own view on reconnect: `unresolvedIds` is the complete set of requests the
	 * page may still replay, so every *other* settled result is free to go, receipt or no receipt.
	 *
	 * This is what makes the acknowledgement scheme robust without a confirm-the-confirmation regress. A receipt
	 * is only as reliable as the socket carrying it, and the request it referred to is already gone from the
	 * page's pending map, so nothing would ever replay it or re-acknowledge it. Restating the whole live set on
	 * each reconnect repairs every receipt lost with the previous socket at once.
	 */
	retain(clientKey: string, unresolvedIds: readonly string[]): void {
		const namespace = this.clients.get(clientKey);
		if (!namespace) return;
		const keep = new Set(unresolvedIds);
		// Deleting the current key mid-iteration is well defined for a Map.
		for (const id of namespace.requests.keys()) if (!keep.has(id)) this.free(namespace, id);
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
	 * still replay-addressable to it, and the namespace is already bounded by admission.
	 */
	clearClient(clientKey: string): boolean {
		const namespace = this.clients.get(clientKey);
		if (!namespace) return true;
		for (const entry of namespace.requests.values()) if (!entry.settled) return false;
		this.clients.delete(clientKey);
		return true;
	}

	clear(): void {
		this.clients.clear();
	}

	/** Drop one settled entry and keep the running weight honest. In-flight ids are left alone. */
	private free(namespace: ClientNamespace<T>, requestId: string): void {
		const entry = namespace.requests.get(requestId);
		if (!entry?.settled) return;
		namespace.requests.delete(requestId);
		namespace.weight -= entry.weight;
	}

	private markSettled(
		clientKey: string,
		namespace: ClientNamespace<T>,
		entry: ReplayEntry<T>,
		weight: number,
	): void {
		// The host may have shut the cache down (`clear`) while this handler was still completing — `clearClient`
		// cannot, it declines while anything is in flight. Either way: never resurrect a dropped namespace.
		if (this.clients.get(clientKey) !== namespace) return;
		entry.settled = true;
		entry.weight = weight;
		namespace.weight += weight;
	}

	private resultWeight(value: T): number {
		// Production values are serialized response strings; admitting 512 large file-read responses would make a
		// count-only bound meaningless. Generic test values still cost one entry.
		return typeof value === "string" ? value.length : 1;
	}
}
