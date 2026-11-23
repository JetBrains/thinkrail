import { expect, test } from "bun:test";
import * as insights from "@thinkrail/ext-session-insights/server";
import {
	BACKGROUND_COMMAND_COMPLETION_MESSAGE,
	type CompletionDelivery as BackgroundDelivery,
} from "pi-background-commands";
import type { DelegationRunDetails, RunLifecycleStatus } from "pi-delegation";
import {
	type CompletionDelivery,
	RECURSION_GUARD_TOOLS,
	SUBAGENT_COMPLETION_MESSAGE,
	type SubagentCompletionDetails,
} from "pi-subagents";
import { SUBAGENT_USAGE_KIND } from "./subagentUsage";

test("the subagent record literals and shapes session insights parses structurally hold", () => {
	expect(SUBAGENT_COMPLETION_MESSAGE).toBe(insights.SUBAGENT_COMPLETION_MESSAGE);
	expect(BACKGROUND_COMMAND_COMPLETION_MESSAGE).toBe(insights.BACKGROUND_COMPLETION_MESSAGE);
	expect(SUBAGENT_USAGE_KIND).toBe(insights.SUBAGENT_USAGE_KIND);
	expect(RECURSION_GUARD_TOOLS).toEqual([
		insights.SUBAGENT_SPAWN_TOOL,
		insights.SUBAGENT_RESULT_TOOL,
	]);
	expect([...insights.SUBAGENT_TOOLS]).toEqual([...RECURSION_GUARD_TOOLS]);
	function pinShapes(
		run: DelegationRunDetails,
		completion: SubagentCompletionDetails,
	): insights.SubagentRunRecord[] {
		return [run, completion];
	}
	function pinWake(subagent: CompletionDelivery, background: BackgroundDelivery): string[] {
		return [subagent, background];
	}
	expect(typeof pinShapes).toBe("function");
	expect(pinWake(insights.WAKE_DELIVERY, insights.WAKE_DELIVERY)).toEqual(["wake", "wake"]);
	const lifecycle: Record<RunLifecycleStatus, true> = {
		queued: true,
		running: true,
		completed: true,
		error: true,
		aborted: true,
	};
	const ended = Object.keys(lifecycle).filter(
		(status) => !insights.UNFINISHED_RUN_STATUSES.includes(status),
	);
	expect(ended).toEqual(["completed", "error", "aborted"]);
	expect(ended.filter((status) => !insights.FAILED_RUN_STATUSES.includes(status))).toEqual([
		"completed",
	]);
});
