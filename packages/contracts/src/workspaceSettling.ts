import type { Workspace } from "./domain";

const DAY_MS = 24 * 60 * 60_000;

/** Why a workspace sits on its project's Settled shelf. */
export type SettledReason =
	| { kind: "override"; since?: number }
	| { kind: "review"; state: "merged" | "closed" }
	| { kind: "idle"; since: number };

export interface SettledRow {
	workspace: Workspace;
	reason: SettledReason;
}

export interface WorkspacePartition {
	live: Workspace[];
	settled: SettledRow[];
}

export type WorkspaceOrder = "created" | "recent";

export interface SettlingContext {
	now: number;
	/** The host's `settleIdleDays`; `null` turns idle settling off. */
	settleIdleDays: number | null;
	/** True while a session in the workspace runs or needs the user — a busy workspace is never settled. */
	busy: (workspace: Workspace) => boolean;
	/** True for the workspace the user is in, while it holds its live latch. */
	latched?: (workspace: Workspace) => boolean;
}

/** Why `workspace` is settled, or `null` while it is live: the one rule the IDE tree and the phone share. */
export function workspaceSettledReason(
	workspace: Workspace,
	context: SettlingContext,
): SettledReason | null {
	if (workspace.kind === "default" || context.busy(workspace)) return null;
	if (workspace.settledOverride === "settled") {
		return workspace.settledAt === undefined
			? { kind: "override" }
			: { kind: "override", since: workspace.settledAt };
	}
	if (workspace.settledOverride === "active") return null;
	if (context.latched?.(workspace)) return null;
	const review = workspace.review;
	if (review?.state === "merged" || review?.state === "closed") {
		if (review.changedAt === undefined) return null;
		const workedSince =
			workspace.lastActiveAt !== undefined && workspace.lastActiveAt > review.changedAt;
		if (!workedSince) return { kind: "review", state: review.state };
	} else if (review && (review.state === undefined || review.state === "open")) {
		return null;
	}
	if (context.settleIdleDays === null || workspace.lastActiveAt === undefined) return null;
	if (context.now - workspace.lastActiveAt > context.settleIdleDays * DAY_MS) {
		return { kind: "idle", since: workspace.lastActiveAt };
	}
	return null;
}

/** The Default row stays first; every other row splits into live and settled, newest created first or by `order`. */
export function partitionWorkspaces(
	rows: readonly Workspace[],
	context: SettlingContext,
	order: WorkspaceOrder = "created",
): WorkspacePartition {
	const live: Workspace[] = [];
	const settled: SettledRow[] = [];
	for (const workspace of rows.toReversed()) {
		if (workspace.kind === "default") continue;
		const reason = workspaceSettledReason(workspace, context);
		if (reason) settled.push({ workspace, reason });
		else live.push(workspace);
	}
	if (order === "recent") {
		const byRecent = (a: Workspace, b: Workspace) => (b.lastActiveAt ?? 0) - (a.lastActiveAt ?? 0);
		live.sort(byRecent);
		settled.sort((a, b) => byRecent(a.workspace, b.workspace));
	}
	const defaults = rows.filter((workspace) => workspace.kind === "default");
	return { live: [...defaults, ...live], settled };
}
