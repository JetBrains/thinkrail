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
	// A thrown foreground error carries `details: {}` — must not narrow.
	expect(readRunDetails({ content: [], details: {} })).toBeUndefined();
	expect(readRunDetails({ content: [] })).toBeUndefined();
	expect(readRunDetails(undefined)).toBeUndefined();
	expect(readRunDetails("plain text")).toBeUndefined();
	// usage missing → rejected (the counters read it unguarded downstream).
	expect(
		readRunDetails({ details: { childSessionId: "c", status: "running", task: "t" } }),
	).toBeUndefined();
});

test("runCounters formats turns/tokens/cost/duration, skipping zeros", () => {
	expect(runCounters(details())).toEqual(["12 turns", "30.4k tok", "$0.04", "45s"]);
	expect(runCounters(details(), "split")).toEqual([
		"12 turns",
		"in 25.1k / out 5.3k",
		"$0.04",
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
	// Before the first partialResult (or a thrown error, details {}): args fallback.
	expect(agentSummary(props({ result: undefined }))).toBe("scout: map the repo");
	// Running: role · counters · current step.
	expect(agentSummary(props())).toBe(
		'scout · 12 turns · 30.4k tok · $0.04 · 45s · bash: rg -n "createServer"',
	);
	// Queued: says so (the chrome's spinner alone can't distinguish it from running).
	expect(
		agentSummary(
			props({ result: { details: details({ status: "queued", usage: details().usage }) } }),
		),
	).toContain("scout · queued");
	// Terminal: no activity suffix.
	expect(agentSummary(props({ result: { details: details({ status: "completed" }) } }))).toBe(
		"scout · 12 turns · 30.4k tok · $0.04 · 45s",
	);
	// A background ack (non-terminal details on a returned tool) is labeled — the card stays frozen there.
	expect(
		agentSummary(props({ args: { subagent_type: "scout", task: "t", run_in_background: true } })),
	).toContain("background");
	// get_subagent_result fallback (no details yet): session_id arg.
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
