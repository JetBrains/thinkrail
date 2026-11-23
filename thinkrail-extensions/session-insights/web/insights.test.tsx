import { describe, expect, test } from "bun:test";
import type { PanelHost } from "@thinkrail/extension-api/web";
import type {
	PlanStep,
	RecoveryChain,
	SessionAnalysis,
	SessionSubagents,
	SubagentRun,
} from "@thinkrail/pi-session-insights/core";
import { TooltipProvider } from "@thinkrail/ui/tooltip";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ErrorsView } from "./errors/ErrorsView";
import { SOURCES } from "./fixtures.test";
import { waveRows } from "./subagents/draw";
import { SubagentsView } from "./subagents/SubagentsView";
import { summary } from "./timeline/fixtures.test";
import { layoutLanes } from "./timeline/layout";
import { hitPlanRow, hitSkillRow, pickIntervals, samePick } from "./trace/bands";
import { eventRef } from "./trace/children";
import { sampleEvents, T0, tool } from "./trace/events.test";
import { TraceModel } from "./trace/model";
import { TurnCard } from "./turns/TurnsView";

const html = (node: ReactNode) => renderToStaticMarkup(<TooltipProvider>{node}</TooltipProvider>);

const counted = (value: number) => ({ value, origin: "counted" as const });

function step(id: string, overrides: Partial<PlanStep> = {}): PlanStep {
	return {
		id,
		title: `Step ${id}`,
		group: "Release",
		origin: "agent",
		first: T0,
		changes: [{ t: T0, status: "pending", eventId: "x", tool: "todo_write" }],
		active: [{ t0: T0 + 1_000, t1: T0 + 5_000 }],
		status: "done",
		toolCalls: counted(2),
		errors: counted(1),
		tokens: {
			value: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, total: 15 },
			origin: "recorded",
		},
		cost: { value: 0.12, origin: "recorded" },
		...overrides,
	};
}

function chain(overrides: Partial<RecoveryChain> = {}): RecoveryChain {
	return {
		index: 0,
		kind: "tool",
		name: "bash",
		attempts: ["t1", "a2"],
		between: [[]],
		outcome: "recovered",
		t0: T0,
		t1: T0 + 9_000,
		recoveredIn: { value: 31_000, origin: "counted" },
		cluster: 0,
		turnId: "u1",
		line: "error: Forbidden non-null assertion.",
		switches: 0,
		prompts: 0,
		...overrides,
	};
}

const ANALYSIS: SessionAnalysis = {
	revision: "r1",
	plan: {
		steps: [step("t_a"), step("t_b", { active: [], status: "pending", listedOnly: true })],
		groups: [{ id: "g", title: "Release" }],
		summaries: [],
		calls: 4,
		rewrites: 0,
	},
	skills: [
		{
			name: "todos",
			t: T0 + 500,
			eventId: "t2",
			via: "read",
			workflow: true,
			scopeEnd: T0 + 30_000,
			scopeBy: "turnEnd",
		},
	],
	turns: [{ turnId: "u1", steps: 2, done: 1, skills: ["todos"] }],
	repeats: [{ ids: ["t1", "t2"], tool: "bash", label: "ls", errors: 0 }],
	chains: [
		chain(),
		chain({ index: 1, attempts: ["t2"], between: [], outcome: "changedApproach", line: "nope" }),
		chain({
			index: 2,
			kind: "model",
			name: "anthropic/m",
			attempts: ["a3"],
			between: [],
			outcome: "never",
			recoveredIn: { value: null, origin: "counted" },
		}),
	],
	clusters: [
		{
			index: 0,
			kind: "tool",
			key: "bash: error: Forbidden",
			sample: "error",
			ids: ["t1"],
			tools: [{ tool: "bash", n: 1 }],
		},
	],
	toolRecovery: [
		{
			tool: "bash",
			failures: 2,
			chains: 2,
			recovered: 1,
			changedApproach: 1,
			gaveUp: 0,
			unfinished: 0,
		},
	],
	toolFailures: 2,
	modelRecovery: { failures: 1, chains: 1, sameModel: 0, afterSwitch: 0, never: 1 },
	transcripts: ["s1"],
};

const HOST = {
	query: () => new Promise(() => {}),
} as unknown as PanelHost;

describe("plan and skill bands", () => {
	test("a pick covers a step's in-progress spans or a skill's scope", () => {
		expect(pickIntervals(ANALYSIS, { kind: "step", id: "t_a" })).toEqual([
			{ t0: T0 + 1_000, t1: T0 + 5_000 },
		]);
		expect(pickIntervals(ANALYSIS, { kind: "skill", index: 0 })).toEqual([
			{ t0: T0 + 500, t1: T0 + 30_000 },
		]);
		expect(pickIntervals(null, { kind: "skill", index: 0 })).toEqual([]);
		expect(samePick({ kind: "step", id: "a" }, { kind: "step", id: "a" })).toBe(true);
		expect(samePick({ kind: "step", id: "a" }, { kind: "skill", index: 0 })).toBe(false);
	});

	test("hit-test steps by their bars and skills by their scope", () => {
		const xOf = (t: number) => (t - T0) / 100;
		const steps = ANALYSIS.plan?.steps ?? [];
		expect(hitPlanRow(steps, xOf, 30)?.id).toBe("t_a");
		expect(hitPlanRow(steps, xOf, 200)).toBeNull();
		expect(hitSkillRow(ANALYSIS.skills, xOf, 100)).toBe(0);
		expect(hitSkillRow(ANALYSIS.skills, xOf, 400)).toBeNull();
	});

	test("the timeline adds a skills row and a row per step", () => {
		const plain = layoutLanes(1, 0);
		const planned = layoutLanes(1, 0, { steps: 2, skills: true });
		expect(planned.lanes.map((lane) => lane.key).slice(-3)).toEqual(["skills", "plan", "plan"]);
		expect(planned.lanes.at(-1)?.step).toBe(1);
		expect(planned.height).toBeGreaterThan(plain.height);
	});

	test("nested transcript ids name their subagent", () => {
		expect(eventRef("child:abc/tool:x:0")).toEqual({ childId: "abc", eventId: "tool:x:0" });
		expect(eventRef("tool:x:0")).toEqual({ eventId: "tool:x:0" });
	});
});

describe("the errors section", () => {
	const model = new TraceModel(sampleEvents());
	test("shows recovery rates, the retried chains and the repeats", () => {
		const markup = html(
			<ErrorsView
				host={HOST}
				sessionId="s"
				model={model}
				analysis={ANALYSIS}
				sources={SOURCES}
				onShowInTrace={() => {}}
			/>,
		);
		expect(markup).toContain('data-testid="errors-tool-row" data-tool="bash"');
		expect(markup).toContain("50% by a retry");
		expect(markup).toContain('data-testid="errors-model-row"');
		expect(markup).toContain('data-outcome="recovered"');
		expect(markup).toContain('data-outcome="never"');
		expect(markup).not.toContain('data-outcome="changedApproach"');
		expect(markup).toContain("Failures without a retry · 1");
		expect(markup).toContain('data-testid="errors-repeat"');
		expect(markup).toContain('data-testid="errors-detail" data-chain="0"');
	});

	test("a chain whose retry never ran reads as unfinished, its attempt as no result", () => {
		const stopped = new TraceModel([
			...sampleEvents(),
			tool("t3", "a3", T0 + 610_000, T0 + 610_000, { missing: true, resultChars: null }),
		]);
		const markup = html(
			<ErrorsView
				host={HOST}
				sessionId="s"
				model={stopped}
				analysis={{
					...ANALYSIS,
					chains: [
						chain({
							attempts: ["t1", "t3"],
							outcome: "unfinished",
							recoveredIn: { value: null, origin: "counted" },
						}),
					],
					toolRecovery: [
						{
							tool: "bash",
							failures: 1,
							chains: 1,
							recovered: 0,
							changedApproach: 0,
							gaveUp: 0,
							unfinished: 1,
						},
					],
				}}
				sources={SOURCES}
				onShowInTrace={() => {}}
			/>,
		);
		expect(markup).toContain('data-outcome="unfinished"');
		expect(markup).toContain("unfinished: the retry got no result");
		expect(markup).toMatch(
			/data-testid="errors-attempt-chip" data-missing="true"[^>]*>.*?no result/,
		);
		expect(markup).toContain("retried: 1 · recovered: 0");
		expect(markup).not.toContain("✓");
		expect(markup).toContain("— by a retry");
	});

	test("says so when the session has no errors or repeats", () => {
		const markup = html(
			<ErrorsView
				host={HOST}
				sessionId="s"
				model={model}
				analysis={{ ...ANALYSIS, chains: [], repeats: [] }}
				sources={SOURCES}
				onShowInTrace={() => {}}
			/>,
		);
		expect(markup).toContain('data-testid="errors-empty"');
	});
});

function run(childId: string, overrides: Partial<SubagentRun> = {}): SubagentRun {
	return {
		childId,
		eventId: `sub:${childId}`,
		spawnEventId: "t2",
		role: "reviewer",
		title: `Review ${childId}`,
		status: "completed",
		background: false,
		model: "anthropic/m",
		spawnAt: T0,
		t0: T0,
		t1: T0 + 20_000,
		duration: { value: 20_000, origin: "counted" },
		tokens: { value: 100, origin: "recorded" },
		cost: { value: 0.1, origin: "recorded" },
		wave: 0,
		lane: 0,
		rationale: { text: "Two reviewers, one per PR.", chars: 26, source: "text", eventId: "a1" },
		result: {
			text: "Fine.",
			chars: 5,
			via: "Agent",
			status: "completed",
			eventId: "t2",
			at: T0 + 20_000,
		},
		consumedBy: "a2",
		consumedAt: T0 + 31_000,
		readDelayMs: 11_000,
		transcript: "available",
		activity: null,
		...overrides,
	};
}

describe("the subagents section", () => {
	const model = new TraceModel(sampleEvents());
	const view: SessionSubagents = {
		revision: "r",
		runs: [run("c2", { lane: 1, status: "failed" }), run("c1")],
		waves: [
			{
				n: 1,
				turnId: "u1",
				turnN: 1,
				t0: T0,
				t1: T0 + 31_000,
				lanes: 2,
				childIds: ["c2", "c1"],
				rationale: { text: "Two reviewers, one per PR.", chars: 26, source: "text", eventId: "a1" },
				tokens: { value: 200, origin: "recorded" },
				cost: { value: 0.2, origin: "recorded" },
			},
		],
		overview: {
			roles: [{ role: "reviewer", n: 2 }],
			maxParallel: 2,
			tokens: { value: 200, origin: "recorded" },
			cost: { value: 0.2, origin: "recorded" },
			failed: 1,
			withErrors: 0,
			unmeasured: 0,
		},
	};

	test("orders a wave's rows by lane, then start", () => {
		const wave = view.waves[0];
		if (!wave) throw new Error("no wave");
		expect(waveRows(wave, view.runs).map((row) => row.childId)).toEqual(["c1", "c2"]);
	});

	test("shows the overview chips and one block per wave with its rationale and lanes", () => {
		const markup = html(
			<SubagentsView model={model} view={view} sources={SOURCES} onOpen={() => {}} />,
		);
		expect(markup).toContain("reviewer ×2");
		expect(markup).toContain("at most 2 in parallel");
		expect(markup).toContain("failed or aborted: 1");
		expect(markup).toContain('data-testid="subagent-wave" data-wave="1"');
		expect(markup).toContain("Two reviewers, one per PR.");
		expect(markup.match(/data-testid="subagent-lane"/g)).toHaveLength(2);
	});

	test("says so when the session spawned none", () => {
		const markup = html(
			<SubagentsView model={model} view={null} sources={SOURCES} onOpen={() => {}} />,
		);
		expect(markup).toContain('data-testid="subagents-empty"');
	});
});

describe("turn card badges", () => {
	test("show the plan steps and the skills of the turn", () => {
		const model = new TraceModel(sampleEvents());
		const markup = html(
			<TurnCard
				model={model}
				index={model.indexOf("u1")}
				turn={summary("u1", 1)}
				gaps={[]}
				sources={SOURCES}
				expanded={false}
				selected={-1}
				palette={null}
				badges={ANALYSIS.turns[0]}
				onToggle={() => {}}
				onSelect={() => {}}
			/>,
		);
		expect(markup).toContain('data-testid="turn-plan-badge"');
		expect(markup).toContain("2 steps · 1 done");
		expect(markup).toContain('data-testid="turn-skill-badge"');
		expect(markup).toContain("todos");
	});
});
