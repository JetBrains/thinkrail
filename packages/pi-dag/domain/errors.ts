export type DagFailureCode =
	| "invalid-graph"
	| "invalid-command"
	| "limit-exceeded"
	| "forbidden"
	| "stale-version"
	| "stale-target"
	| "resource-in-use"
	| "recovery-required"
	| "not-found"
	| "id-reused"
	| "context-required"
	| "model-unavailable"
	| "history-unavailable"
	| "storage-error"
	| "corrupt-state"
	| "commit-unknown"
	| "cursor-expired"
	| "closed"
	| "revoked";

export interface DagFailure {
	code: DagFailureCode;
	message: string;
	currentVersion?: number;
	nodeIds?: string[];
}

export type DagResult<T> = { ok: true; value: T } | { ok: false; error: DagFailure };

export class DagError extends Error {
	constructor(readonly failure: DagFailure) {
		super(failure.message);
		this.name = "DagError";
	}
}

export function fail(code: DagFailureCode, message: string): never {
	throw new DagError({ code, message });
}

export function canonicalJson(value: unknown, depth = 0): string {
	if (depth > 64) return fail("limit-exceeded", "JSON nesting exceeds 64 levels");
	if (value === null || typeof value === "boolean" || typeof value === "string")
		return JSON.stringify(value);
	if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
	if (Array.isArray(value))
		return `[${Array.from(value, (item) => canonicalJson(item, depth + 1)).join(",")}]`;
	if (
		typeof value !== "object" ||
		value === null ||
		(Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
	) {
		return fail("invalid-command", "Only finite JSON values are supported");
	}
	return `{${Object.entries(value)
		.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
		.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item, depth + 1)}`)
		.join(",")}}`;
}
