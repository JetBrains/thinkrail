import { expect, test } from "bun:test";
import type { DelegationRunDetails } from "@thinkrail/contracts";
import type { ToolRenderProps } from "../../toolRegistry";
import { agentSummary, readRunDetails, runCounters } from "./runDetails";

function details(overrides: Partial<DelegationRunDetails> = {}): DelegationRunDetails {
	return {
		childSessionId: "child-1",
		roleName: "scout",
		task: "map the repo",
		status: "running",
		model: "anthropic/claude-test",
		usage: {
			input: 25_100,
			output: 5_300,
			cacheRead: 0,
			cacheWrite: 0,
			cost: 0.04,
			turns: 12,
			contextTokens: 30_000,
		},
		durationMs: 45_000,
		activity: 'bash: rg -n "createServer"',
		...overrides,
	};
}

function props(overrides: Partial<ToolRenderProps> = {}): ToolRenderProps {
	return {
		toolCallId: "tc1",
		toolName: "Agent",
		args: { subagent_type: "scout", task: "map the repo" },
		result: { content: [{ type: "text", text: "running" }], details: details() },
		status: "running",
		streaming: false,
		workspaceRoot: undefined,
		...overrides,
	};
}

test("readRunDetails narrows a result's details and rejects malformed shapes", () => {
	expect(readRunDetails({ content: [], details: details() })?.childSessionId).toBe("child-1");
	expect(readRunDetails({ content: [], details: {} })).toBeUndefined();
	expect(readRunDetails({ content: [] })).toBeUndefined();
	expect(readRunDetails(undefined)).toBeUndefined();
	expect(readRunDetails("plain text")).toBeUndefined();
	expect(
		readRunDetails({ details: { childSessionId: "c", status: "running", task: "t" } }),
	).toBeUndefined();
	expect(
		readRunDetails({ content: [], details: details({ status: "done" as never }) }),
	).toBeUndefined();
	expect(
		readRunDetails({
			content: [],
			details: { ...details(), usage: {} as never },
		}),
	).toBeUndefined();
});

test("runCounters formats turns/tokens/cost/duration, skipping zeros", () => {
	expect(runCounters(details())).toEqual(["12 turns", "30k tok", "$0.040", "45s"]);
	expect(runCounters(details(), "split")).toEqual([
		"12 turns",
		"in 25k / out 5.3k",
		"$0.040",
		"45s",
	]);
	const fresh = details({
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			cost: 0,
			turns: 0,
			contextTokens: 0,
		},
		durationMs: 0,
	});
	expect(runCounters(fresh)).toEqual([]);
});

test("agentSummary is the live collapsed-header line, per status", () => {
	expect(agentSummary(props({ result: undefined }))).toBe("scout: map the repo");
	expect(agentSummary(props())).toBe(
		'scout · 12 turns · 30k tok · $0.040 · 45s · bash: rg -n "createServer"',
	);
	expect(
		agentSummary(
			props({ result: { details: details({ status: "queued", usage: details().usage }) } }),
		),
	).toContain("scout · queued");
	expect(agentSummary(props({ result: { details: details({ status: "completed" }) } }))).toBe(
		"scout · 12 turns · 30k tok · $0.040 · 45s",
	);
	expect(
		agentSummary(props({ args: { subagent_type: "scout", task: "t", run_in_background: true } })),
	).toContain("background");
	expect(
		agentSummary(
			props({
				toolName: "get_subagent_result",
				args: { session_id: "child-1" },
				result: undefined,
			}),
		),
	).toBe("child-1");
});
