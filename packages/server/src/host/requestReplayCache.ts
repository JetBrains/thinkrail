export class RequestReplayConflictError extends Error {
	constructor(id: string) {
		super(`request id "${id}" was reused with a different payload`);
		this.name = "RequestReplayConflictError";
	}
}

export class RequestReplayOverflowError extends Error {
	constructor(clientKey: string) {
		super(
			`replay namespace for client "${clientKey}" is full: unacknowledged results must be read first`,
		);
		this.name = "RequestReplayOverflowError";
	}
}

export class RequestReplayUnretainedError extends Error {
	constructor(id: string) {
		super(`request id "${id}" already executed; its response exceeded the retention budget`);
		this.name = "RequestReplayUnretainedError";
	}
}

interface ReplayEntry<T> {
	readonly fingerprint: string;
	result: Promise<T> | null;
	settled: boolean;
	weight: number;
}

interface ClientNamespace<T> {
	readonly requests: Map<string, ReplayEntry<T>>;
	weight: number;
}

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
			if (existing.result === null) throw new RequestReplayUnretainedError(requestId);
			return existing.result;
		}

		if (requests.size >= this.maxRequestsPerClient) {
			throw new RequestReplayOverflowError(clientKey);
		}

		const result = Promise.resolve().then(execute);
		const entry: ReplayEntry<T> = { fingerprint, result, settled: false, weight: 0 };
		requests.set(requestId, entry);
		result.then(
			(value) => this.markSettled(clientKey, namespace, entry, this.resultWeight(value)),
			() => this.markSettled(clientKey, namespace, entry, 1),
		);
		return result;
	}

	acknowledge(clientKey: string, requestIds: readonly string[]): void {
		const namespace = this.clients.get(clientKey);
		if (!namespace) return;
		for (const id of requestIds) this.free(namespace, id);
	}

	retain(clientKey: string, unresolvedIds: readonly string[]): void {
		const namespace = this.clients.get(clientKey);
		if (!namespace) return;
		const keep = new Set(unresolvedIds);
		for (const id of namespace.requests.keys()) if (!keep.has(id)) this.free(namespace, id);
	}

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
		if (this.clients.get(clientKey) !== namespace) return;
		entry.settled = true;

		if (namespace.weight + weight > this.maxWeightPerClient) {
			entry.result = null;
			return;
		}
		entry.weight = weight;
		namespace.weight += weight;
	}

	private resultWeight(value: T): number {
		return typeof value === "string" ? value.length : 1;
	}
}
