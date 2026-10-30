import { RUN_RECIPE_LIMITS } from "@thinkrail/contracts";
import { CodedError } from "@thinkrail/shared/codedError";

export interface PortLeaseInput {
	/** Declared variable → natural port. */
	natural: Record<string, number>;
	/** This workspace's persisted assignments. */
	current: Record<string, number>;
	/** The Default workspace prefers the natural port; a worktree scans upward from natural + 1. */
	isDefaultWorkspace: boolean;
	/** Something is live in this workspace: its assignments are kept as they are, never re-probed. */
	workspaceLive: boolean;
	/** Ports no candidate may take: leases of live runs elsewhere on this host and sibling workspaces' assignments. */
	taken: ReadonlySet<number>;
	isFree: (port: number) => Promise<boolean>;
}

const MAX_MISSES = 64;

async function pick(
	start: number,
	preferred: number | null,
	excluded: ReadonlySet<number>,
	isFree: (port: number) => Promise<boolean>,
): Promise<number> {
	let misses = 0;
	const candidates = function* () {
		if (preferred !== null) yield preferred;
		for (let port = start; port <= RUN_RECIPE_LIMITS.portRange.max; port += 1) {
			if (port !== preferred) yield port;
		}
	};
	for (const candidate of candidates()) {
		if (excluded.has(candidate)) continue;
		if (await isFree(candidate)) return candidate;
		misses += 1;
		if (misses >= MAX_MISSES) break;
	}
	throw new CodedError("RUN_NO_FREE_PORT", `No free port found near ${preferred ?? start}`);
}

/**
 * Resolve every declared variable to a port for one workspace start. Pure apart from the probe; the caller
 * serializes calls and marks the result as live before it yields, so concurrent starts cannot collide.
 */
export async function allocatePorts(input: PortLeaseInput): Promise<Record<string, number>> {
	const result: Record<string, number> = {};
	const chosen = new Set<number>();
	const excluded = (): ReadonlySet<number> => new Set([...input.taken, ...chosen]);

	// Kept assignments first, so a fresh variable cannot take a port a sibling variable already holds.
	for (const name of Object.keys(input.natural)) {
		const held = input.current[name];
		if (held === undefined || input.taken.has(held) || chosen.has(held)) continue;
		if (input.workspaceLive || (await input.isFree(held))) {
			result[name] = held;
			chosen.add(held);
		}
	}
	for (const [name, natural] of Object.entries(input.natural)) {
		if (result[name] !== undefined) continue;
		const port = input.isDefaultWorkspace
			? await pick(natural + 1, natural, excluded(), input.isFree)
			: await pick(natural + 1, null, excluded(), input.isFree);
		result[name] = port;
		chosen.add(port);
	}
	return result;
}

/** One promise chain: allocations run strictly one after another, whatever the caller's concurrency. */
export function createSerialQueue(): <T>(task: () => Promise<T>) => Promise<T> {
	let tail: Promise<unknown> = Promise.resolve();
	return <T>(task: () => Promise<T>): Promise<T> => {
		const next = tail.then(task, task);
		tail = next.catch(() => {});
		return next;
	};
}
