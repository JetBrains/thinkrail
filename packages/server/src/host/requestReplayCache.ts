import { CodedError } from "@thinkrail/shared/codedError";

export class RequestReplayConflictError extends Error {
	constructor(id: string) {
		super(`request id "${id}" was reused with a different payload`);
		this.name = "RequestReplayConflictError";
	}
}

export type ReplayLoad = Record<string, { pending: number; settled: number; abandoned: number }>;

export class RequestReplayOverflowError extends CodedError {
	constructor(readonly load: ReplayLoad | null) {
		super(
			"REQUEST_REPLAY_OVERFLOW",
			"replay namespace is full: unacknowledged results must be read first",
		);
		this.name = "RequestReplayOverflowError";
	}
}

export class RequestAbandonedError extends Error {
	readonly code = "REQUEST_ABANDONED";

	constructor() {
		super("the page gave up on a request before its handler settled");
		this.name = "RequestAbandonedError";
	}
}

export class AbandonmentReportBudget {
	private readonly reported = new Set<string>();

	constructor(private readonly allowance = 10) {}

	admit(method: string): boolean {
		if (this.reported.has(method) || this.reported.size >= this.allowance) return false;
		this.reported.add(method);
		return true;
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
	readonly label: string;
	result: Promise<T> | null;
	settled: boolean;
	abandoned: boolean;
	weight: number;
}

interface ClientNamespace<T> {
	readonly requests: Map<string, ReplayEntry<T>>;
	weight: number;
	abandoned: number;
	overflowing: boolean;
}

function replayLoad(
	entries: Iterable<{ label: string; settled: boolean; abandoned: boolean }>,
): ReplayLoad {
	const load: ReplayLoad = {};
	for (const entry of entries) {
		const counts = load[entry.label] ?? { pending: 0, settled: 0, abandoned: 0 };
		if (entry.abandoned) counts.abandoned++;
		else if (entry.settled) counts.settled++;
		else counts.pending++;
		load[entry.label] = counts;
	}
	return load;
}

export function heaviestReplayMethod(load: ReplayLoad): string | undefined {
	const occupancy = (counts: ReplayLoad[string]) =>
		counts.pending + counts.settled + counts.abandoned;
	return Object.entries(load).sort(
		([nameA, a], [nameB, b]) =>
			occupancy(b) - occupancy(a) || b.pending - a.pending || nameA.localeCompare(nameB),
	)[0]?.[0];
}

export class RequestReplayCache<T> {
	private readonly clients = new Map<string, ClientNamespace<T>>();

	private readonly liveLowWater: number;
	private readonly trackedLowWater: number;

	constructor(
		private readonly maxRequestsPerClient = 512,
		private readonly maxWeightPerClient = 16 * 1024 * 1024,
		private readonly maxTrackedPerClient = 2048,
	) {
		this.liveLowWater = Math.floor(maxRequestsPerClient * 0.9);
		this.trackedLowWater = Math.floor(maxTrackedPerClient * 0.9);
	}

	run(
		clientKey: string,
		requestId: string,
		fingerprint: string,
		execute: () => Promise<T> | T,
		label = "unknown method",
	): Promise<T> {
		let namespace = this.clients.get(clientKey);
		if (!namespace) {
			namespace = { requests: new Map(), weight: 0, abandoned: 0, overflowing: false };
			this.clients.set(clientKey, namespace);
		}
		const requests = namespace.requests;

		const existing = requests.get(requestId);
		if (existing) {
			if (existing.fingerprint !== fingerprint) throw new RequestReplayConflictError(requestId);
			if (existing.result === null) throw new RequestReplayUnretainedError(requestId);
			return existing.result;
		}

		const live = requests.size - namespace.abandoned;
		if (live >= this.maxRequestsPerClient || requests.size >= this.maxTrackedPerClient) {
			const load = namespace.overflowing ? null : replayLoad(requests.values());
			namespace.overflowing = true;
			throw new RequestReplayOverflowError(load);
		}
		if (live < this.liveLowWater && requests.size < this.trackedLowWater)
			namespace.overflowing = false;

		const result = Promise.resolve().then(execute);
		const entry: ReplayEntry<T> = {
			fingerprint,
			label,
			result,
			settled: false,
			abandoned: false,
			weight: 0,
		};
		requests.set(requestId, entry);
		result.then(
			(value) => this.markSettled(clientKey, namespace, requestId, entry, this.resultWeight(value)),
			() => this.markSettled(clientKey, namespace, requestId, entry, 1),
		);
		return result;
	}

	acknowledge(clientKey: string, requestIds: readonly string[]): string[] {
		const namespace = this.clients.get(clientKey);
		if (!namespace) return [];
		const abandoned: string[] = [];
		for (const id of requestIds) this.release(namespace, id, abandoned);
		return abandoned;
	}

	retain(clientKey: string, unresolvedIds: readonly string[]): string[] {
		const namespace = this.clients.get(clientKey);
		if (!namespace) return [];
		const keep = new Set(unresolvedIds);
		const abandoned: string[] = [];
		for (const id of namespace.requests.keys())
			if (!keep.has(id)) this.release(namespace, id, abandoned);
		return abandoned;
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

	private release(namespace: ClientNamespace<T>, requestId: string, abandoned: string[]): void {
		const entry = namespace.requests.get(requestId);
		if (!entry) return;
		if (entry.settled) {
			namespace.requests.delete(requestId);
			namespace.weight -= entry.weight;
		} else if (!entry.abandoned) {
			entry.abandoned = true;
			namespace.abandoned++;
			abandoned.push(entry.label);
		}
	}

	private markSettled(
		clientKey: string,
		namespace: ClientNamespace<T>,
		requestId: string,
		entry: ReplayEntry<T>,
		weight: number,
	): void {
		if (this.clients.get(clientKey) !== namespace) return;
		entry.settled = true;
		if (entry.abandoned) {
			namespace.requests.delete(requestId);
			namespace.abandoned--;
			return;
		}

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
