import type { ProjectRun, RunExecution, RunWorkspaceState } from "@thinkrail/contracts";
import { RUN_PROTOCOL_VERSION } from "@thinkrail/contracts";

export const LIVE_RUN_STATUSES: ReadonlySet<RunExecution["status"]> = new Set([
	"starting",
	"running",
	"listening",
	"stopping",
]);

export function isLiveRun(execution: Pick<RunExecution, "status">): boolean {
	return LIVE_RUN_STATUSES.has(execution.status);
}

/** The execution the topbar follows: the most recently started one, live first. */
export function latestExecution(state: RunWorkspaceState | undefined): RunExecution | null {
	if (!state || state.executions.length === 0) return null;
	const live = state.executions.filter(isLiveRun);
	const pool = live.length > 0 ? live : state.executions;
	return pool.reduce((latest, candidate) =>
		candidate.startedAt > latest.startedAt ? candidate : latest,
	);
}

export function executionForTarget(
	state: RunWorkspaceState | undefined,
	targetId: string | null,
): RunExecution | null {
	return state?.executions.find((execution) => execution.targetId === targetId) ?? null;
}

export function sameRunState(a: RunWorkspaceState | undefined, b: RunWorkspaceState): boolean {
	return a !== undefined && JSON.stringify(a) === JSON.stringify(b);
}

export function sameProjectRun(a: ProjectRun | undefined, b: ProjectRun): boolean {
	return a !== undefined && JSON.stringify(a) === JSON.stringify(b);
}

interface ProtocolState {
	protocolVersion: number | null;
}

export function selectSupportsRun(state: ProtocolState): boolean {
	return state.protocolVersion !== null && state.protocolVersion >= RUN_PROTOCOL_VERSION;
}
