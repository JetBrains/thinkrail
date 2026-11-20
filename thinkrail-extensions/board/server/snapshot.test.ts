import { describe, expect, test } from "bun:test";
import type { Forecast } from "./forecast";
import type { HealthView } from "./health";
import type { InitiativeNode, RoadmapView } from "./roadmap";
import type { Rollup } from "./rollups";
import { roadmapSnapshot } from "./snapshot";

function node(id: string, extra: Partial<InitiativeNode> = {}): InitiativeNode {
	return {
		id,
		title: `Initiative ${id}`,
		outcome: "",
		criteria: [],
		horizon: "now",
		rank: 1,
		specRefs: [],
		updates: [],
		cardIds: [],
		externalCards: [],
		createdAt: 0,
		updatedAt: 0,
		depth: 0,
		childIds: [],
		memberCardIds: [],
		memberExternalCards: [],
		...extra,
	};
}

function rollup(done: number, total: number): Rollup {
	return {
		cards: total + 1,
		byCategory: {
			triage: 1,
			backlog: total - done,
			unstarted: 0,
			started: 0,
			review: 0,
			completed: done,
			canceled: 0,
		},
		points: { total, completed: done },
		agents: { working: 0, waiting: 0, failed: 0 },
		blocked: 0,
		timeSpentMs: 0,
	};
}

const health = (extra: Partial<HealthView> = {}): HealthView => ({
	suggested: "on_track",
	effective: "on_track",
	reasons: [],
	...extra,
});

const inputs = {
	weeklyPoints: [],
	remainingPoints: 0,
	totalPoints: 0,
	trials: 2000,
	seed: 1,
	from: "2026-11-18",
};

function view(initiatives: InitiativeNode[]): RoadmapView {
	const forecast: Record<string, Forecast> = {
		"I-1": {
			status: "ok",
			p50: "2026-12-01",
			p85: "2026-12-20",
			p50Weeks: 2,
			p85Weeks: 5,
			inputs,
		},
		"I-2": { status: "insufficient", reason: "history", inputs },
		"I-3": { status: "done", inputs },
	};
	return {
		projectId: "p1",
		projectName: "ThinkRail",
		initiatives,
		projects: [],
		externalCards: [],
		rollups: {
			initiatives: { "I-1": rollup(1, 4), "I-2": rollup(0, 0), "I-3": rollup(2, 2) },
			projects: {},
			milestones: {},
		},
		health: {
			"I-1": health({
				suggested: "at_risk",
				effective: "at_risk",
				reasons: [{ kind: "blocked", level: "at_risk", cardIds: ["TR-2"] }],
			}),
			"I-2": health({ override: "off_track", effective: "off_track" }),
			"I-3": health(),
		},
		forecast,
		schedule: { today: 0, finish: 0, nodes: [], edges: [], criticalPath: [], cycles: [] },
		critical: {},
		throughput: { weeks: [], completed: 0, insufficientData: true },
		cycleTimes: {},
		insufficientData: { throughput: true, initiatives: [] },
	};
}

describe("the roadmap snapshot", () => {
	const initiatives = [
		node("I-2", {
			title: "Insights",
			horizon: "now",
			rank: 2,
			outcome: "See the flow.\n\nRabbit holes:\n- charts",
			parentId: "I-3",
			updates: [
				{ id: "U-1", at: 10, text: "Old", health: "on_track", publishedAt: 10 },
				{ id: "U-2", at: 20, text: "Half done\nmore to go", health: "at_risk", publishedAt: 20 },
				{ id: "U-3", at: 30, text: "Draft", health: "on_track" },
			],
		}),
		node("I-1", {
			title: "Roadmap",
			horizon: "now",
			rank: 1,
			target: "2026-12-31",
			criteria: ["Forecasts", " "],
		}),
		node("I-3", { title: "Planning", horizon: "later", rank: 1 }),
		node("I-4", { title: "Proposal", horizon: "next", proposed: true }),
		node("I-5", { title: "Shipped", horizon: "now", closedAt: 99 }),
	];

	test("lists the accepted open initiatives by horizon and rank, with their facts and latest published update", () => {
		expect(roadmapSnapshot(view(initiatives), "2026-11-18")).toBe(
			[
				"# Roadmap — ThinkRail",
				"",
				"Generated on 2026-11-18 from the ThinkRail board. Forecasts are 50 % / 85 % ranges from the board's throughput, not commitments.",
				"",
				"## Now",
				"",
				"### I-1 · Roadmap",
				"",
				"- **Health:** At risk (suggested) — blocked on the critical path: TR-2",
				"- **Progress:** 1/4 cards · 25 %",
				"- **Target:** 2026-12-31",
				"- **Forecast:** 50 % by 2026-12-01 · 85 % by 2026-12-20",
				"- **Success criteria:**",
				"  - Forecasts",
				"",
				"### I-2 · Insights",
				"",
				"Part of I-3 · Planning.",
				"",
				"See the flow.",
				"",
				"Rabbit holes:",
				"- charts",
				"",
				"- **Health:** Off track",
				"- **Progress:** 0/0 cards",
				"- **Forecast:** not enough data yet",
				"",
				"**Latest update** (at risk):",
				"",
				"> Half done",
				"> more to go",
				"",
				"## Next",
				"",
				"_No initiatives._",
				"",
				"## Later",
				"",
				"### I-3 · Planning",
				"",
				"- **Health:** On track (suggested)",
				"- **Progress:** 2/2 cards · 100 %",
				"- **Forecast:** nothing left to do",
				"",
				"## Closed",
				"",
				"- I-5 · Shipped",
				"",
			].join("\n"),
		);
	});

	test("is deterministic: the same roadmap in any order on the same day writes the same bytes", () => {
		const first = roadmapSnapshot(view(initiatives), "2026-11-18");
		expect(roadmapSnapshot(view([...initiatives].reverse()), "2026-11-18")).toBe(first);
		expect(roadmapSnapshot(view(initiatives), "2026-11-18")).toBe(first);
		expect(first).not.toMatch(/\d{2}:\d{2}/);
		expect(roadmapSnapshot(view([]), "2026-11-18")).toContain("## Now\n\n_No initiatives._");
	});
});
