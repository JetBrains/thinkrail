import { describe, expect, test } from "bun:test";
import type { RunExecution, RunWorkspaceState } from "@thinkrail/contracts";
import { RUN_PROTOCOL_VERSION } from "@thinkrail/contracts";
import { executionForTarget, isLiveRun, latestExecution, selectSupportsRun } from "./run";

function execution(partial: Partial<RunExecution> & { runId: string }): RunExecution {
	return {
		targetId: "dev",
		tabKey: "thinkrail-run:dev",
		status: "running",
		startedAt: 1,
		ports: {},
		origin: "user",
		...partial,
	};
}

describe("run slice helpers", () => {
	test("the topbar follows the most recently started live run, else the most recent run", () => {
		const state: RunWorkspaceState = {
			workspaceId: "ws",
			executions: [
				execution({ runId: "old-live", startedAt: 5, status: "listening" }),
				execution({ runId: "new-live", targetId: "desktop", startedAt: 9, status: "starting" }),
				execution({ runId: "newest-ended", targetId: "test", startedAt: 20, status: "exited" }),
			],
		};
		expect(latestExecution(state)?.runId).toBe("new-live");
		expect(
			latestExecution({
				workspaceId: "ws",
				executions: [
					execution({ runId: "a", startedAt: 3, status: "exited" }),
					execution({ runId: "b", targetId: "test", startedAt: 7, status: "stopped" }),
				],
			})?.runId,
		).toBe("b");
		expect(latestExecution(undefined)).toBeNull();
		expect(latestExecution({ workspaceId: "ws", executions: [] })).toBeNull();
	});

	test("targets resolve by id, including the prepare-only run", () => {
		const state: RunWorkspaceState = {
			workspaceId: "ws",
			executions: [execution({ runId: "p", targetId: null }), execution({ runId: "d" })],
		};
		expect(executionForTarget(state, null)?.runId).toBe("p");
		expect(executionForTarget(state, "dev")?.runId).toBe("d");
		expect(executionForTarget(state, "test")).toBeNull();
	});

	test("liveness and protocol support", () => {
		expect(isLiveRun({ status: "stopping" })).toBe(true);
		expect(isLiveRun({ status: "exited" })).toBe(false);
		expect(selectSupportsRun({ protocolVersion: RUN_PROTOCOL_VERSION })).toBe(true);
		expect(selectSupportsRun({ protocolVersion: RUN_PROTOCOL_VERSION - 1 })).toBe(false);
		expect(selectSupportsRun({ protocolVersion: null })).toBe(false);
	});
});
