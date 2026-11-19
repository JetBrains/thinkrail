import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_SETTINGS } from "./model";
import {
	BoardStore,
	type CardsFile,
	type InitiativesFile,
	NewerBoardStoreError,
	type ProjectsFile,
} from "./store";

const roots: string[] = [];

function setup() {
	const root = mkdtempSync(join(tmpdir(), "board-store-"));
	roots.push(root);
	const warnings: string[] = [];
	const log = { info: () => {}, warn: (message: string) => warnings.push(message) };
	return { root, warnings, store: () => new BoardStore(root, log, () => 42) };
}

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const file: CardsFile = {
	version: 2,
	prefix: "TR",
	nextNumber: 2,
	cards: [
		{
			id: "TR-1",
			source: { kind: "native", ref: "TR-1" },
			title: "Card",
			description: "Why",
			acceptance: ["works"],
			type: "bug",
			size: "M",
			sizeSuggested: true,
			labels: ["ui"],
			blocks: [],
			specRefs: ["module-ext-board"],
			rank: 1,
			category: "started",
			column: "building",
			ownerHuman: "me",
			attempts: [
				{
					workspaceId: "w1",
					sessionId: "s1",
					workflow: "implement",
					startedAt: 3,
					notes: [{ text: "half way", at: 4 }],
					merged: true,
				},
			],
			createdBy: "agent",
			origin: { sessionId: "s0", cardId: "TR-9" },
			createdAt: 1,
			updatedAt: 2,
			cancelPending: { workspaceId: "w1", at: 5 },
		},
	],
};

describe("BoardStore", () => {
	test("round-trips cards, settings and transitions through atomic writes", () => {
		const { root, store } = setup();
		const first = store();
		expect(first.cards("p1")).toBeNull();
		expect(first.settings("p1")).toEqual(DEFAULT_SETTINGS);
		first.saveCards("p1", file);
		first.saveSettings("p1", { ...DEFAULT_SETTINGS, preset: "solo" });
		const transition = {
			cardId: "TR-1",
			from: null,
			to: { category: "backlog" as const, column: "backlog" },
			at: 1,
			actor: "human" as const,
			reason: "created",
		};
		first.appendTransitions("p1", [transition]);
		first.appendTransitions("p1", [{ ...transition, at: 2 }]);
		expect(readdirSync(join(root, "p1")).sort()).toEqual([
			"cards.json",
			"settings.json",
			"transitions.jsonl",
		]);
		const second = store();
		expect(second.cards("p1")).toEqual(file);
		expect(second.settings("p1").preset).toBe("solo");
		expect(second.transitions("p1").map((entry) => entry.at)).toEqual([1, 2]);
		expect(second.projectIds()).toEqual(["p1"]);
		expect(JSON.parse(readFileSync(join(root, "p1", "settings.json"), "utf8")).version).toBe(1);
	});

	test("moves an unreadable file aside instead of overwriting it, and drops unreadable cards", () => {
		const { root, store, warnings } = setup();
		mkdirSync(join(root, "p1"));
		writeFileSync(join(root, "p1", "cards.json"), "{ not json");
		writeFileSync(join(root, "p1", "settings.json"), JSON.stringify({ preset: "solo" }));
		const board = store();
		expect(board.cards("p1")).toBeNull();
		expect(board.settings("p1")).toEqual(DEFAULT_SETTINGS);
		expect(readdirSync(join(root, "p1")).sort()).toEqual([
			"cards.json.corrupt-42",
			"settings.json.corrupt-42",
		]);
		expect(warnings).toHaveLength(2);

		mkdirSync(join(root, "p2"));
		writeFileSync(
			join(root, "p2", "cards.json"),
			JSON.stringify({
				version: 1,
				prefix: "OT",
				nextNumber: 3,
				cards: [
					file.cards[0],
					{ id: "OT-2" },
					{ title: "no id", category: "backlog", column: "x" },
				],
			}),
		);
		expect(
			store()
				.cards("p2")
				?.cards.map((card) => card.id),
		).toEqual(["TR-1"]);
		expect(warnings.at(-1)).toContain("dropped 2 unreadable card(s)");
	});

	test("fills defaults for missing card fields and malformed transition lines", () => {
		const { root, store } = setup();
		mkdirSync(join(root, "p1"));
		writeFileSync(
			join(root, "p1", "cards.json"),
			JSON.stringify({
				version: 1,
				prefix: "TR",
				cards: [{ id: "TR-1", title: "Bare", category: "backlog", column: "backlog", size: "XL" }],
			}),
		);
		writeFileSync(join(root, "p1", "transitions.jsonl"), 'not json\n{"cardId":"TR-1","at":1}\n\n');
		const board = store();
		expect(board.cards("p1")).toEqual({
			version: 2,
			prefix: "TR",
			nextNumber: 1,
			cards: [
				{
					id: "TR-1",
					source: { kind: "native", ref: "TR-1" },
					title: "Bare",
					description: "",
					acceptance: [],
					type: "feature",
					labels: [],
					blocks: [],
					specRefs: [],
					rank: 0,
					category: "backlog",
					column: "backlog",
					ownerHuman: "",
					attempts: [],
					createdBy: "human",
					createdAt: 0,
					updatedAt: 0,
				},
			],
		});
		expect(board.transitions("p1")).toEqual([{ cardId: "TR-1", at: 1 } as never]);
	});

	test("refuses a board a newer ThinkRail wrote rather than lose its data", () => {
		const { root, store } = setup();
		mkdirSync(join(root, "p1"));
		writeFileSync(join(root, "p1", "cards.json"), JSON.stringify({ version: 3, cards: [] }));
		expect(() => store().cards("p1")).toThrow(NewerBoardStoreError);
		expect(readdirSync(join(root, "p1"))).toEqual(["cards.json"]);
	});

	test("round-trips initiatives and roadmap projects, and reads the cards' roadmap fields", () => {
		const { root, store } = setup();
		const first = store();
		expect(first.initiatives("p1")).toEqual({
			version: 1,
			nextNumber: 1,
			nextUpdateNumber: 1,
			initiatives: [],
		});
		expect(first.roadmapProjects("p1")).toEqual({
			version: 1,
			nextNumber: 1,
			nextMilestoneNumber: 1,
			projects: [],
		});
		const initiatives: InitiativesFile = {
			version: 1,
			nextNumber: 3,
			nextUpdateNumber: 2,
			initiatives: [
				{
					id: "I-2",
					parentId: "I-1",
					title: "Roadmap",
					outcome: "Plans follow the work",
					criteria: ["forecast"],
					horizon: "now",
					rank: 2,
					target: "2026-12-01",
					appetiteDays: 20,
					specRefs: ["module-ext-board"],
					health: { override: "at_risk", note: "slipping" },
					updates: [{ id: "U-1", at: 5, text: "Week one", health: "on_track", publishedAt: 6 }],
					cardIds: ["TR-1"],
					externalCards: [{ projectId: "p2", cardId: "OT-1" }],
					proposed: true,
					proposedBy: "agent",
					createdAt: 1,
					updatedAt: 2,
				},
			],
		};
		const projects: ProjectsFile = {
			version: 1,
			nextNumber: 2,
			nextMilestoneNumber: 3,
			projects: [
				{
					id: "P-1",
					initiativeId: "I-2",
					title: "Step graph",
					milestones: [
						{ id: "M-1", title: "Alpha", target: "2026-11-30" },
						{ id: "M-2", title: "Beta" },
					],
					proposed: true,
					proposedBy: "agent",
					createdAt: 3,
					updatedAt: 4,
				},
			],
		};
		first.saveInitiatives("p1", initiatives);
		first.saveRoadmapProjects("p1", projects);
		expect(readdirSync(join(root, "p1")).sort()).toEqual(["initiatives.json", "projects.json"]);
		const second = store();
		expect(second.initiatives("p1")).toEqual(initiatives);
		expect(second.roadmapProjects("p1")).toEqual(projects);
		expect(second.projectIds()).toEqual(["p1"]);

		const card = file.cards[0] as CardsFile["cards"][number];
		second.saveCards("p1", {
			...file,
			cards: [
				{
					...card,
					roadmapProjectId: "P-1",
					milestoneId: "M-1",
					pinnedStart: "2026-11-20",
					estimateDays: 2.5,
				},
			],
		});
		expect(store().cards("p1")?.cards[0]).toMatchObject({
			roadmapProjectId: "P-1",
			milestoneId: "M-1",
			pinnedStart: "2026-11-20",
			estimateDays: 2.5,
		});
	});

	test("fills roadmap defaults, drops malformed roadmap fields and moves unreadable roadmap files aside", () => {
		const { root, store, warnings } = setup();
		mkdirSync(join(root, "p1"));
		writeFileSync(
			join(root, "p1", "initiatives.json"),
			JSON.stringify({
				version: 1,
				initiatives: [
					{
						id: "I-1",
						title: "Bare",
						horizon: "someday",
						target: "2026-02-30",
						appetiteDays: -3,
						health: { override: "great" },
						updates: [{ id: "U-1", text: "x", health: "meh" }, { text: "no id" }],
						externalCards: [{ projectId: "p2" }],
					},
					{ id: "I-2" },
				],
			}),
		);
		writeFileSync(join(root, "p1", "projects.json"), JSON.stringify({ version: 1, projects: "x" }));
		writeFileSync(
			join(root, "p1", "cards.json"),
			JSON.stringify({
				version: 1,
				prefix: "TR",
				cards: [
					{
						id: "TR-1",
						title: "Odd",
						category: "backlog",
						column: "backlog",
						milestoneId: "M-1",
						pinnedStart: "soon",
						estimateDays: 0,
					},
				],
			}),
		);
		const board = store();
		expect(board.initiatives("p1")).toEqual({
			version: 1,
			nextNumber: 1,
			nextUpdateNumber: 1,
			initiatives: [
				{
					id: "I-1",
					title: "Bare",
					outcome: "",
					criteria: [],
					horizon: "later",
					rank: 0,
					specRefs: [],
					updates: [{ id: "U-1", at: 0, text: "x", health: "on_track" }],
					cardIds: [],
					externalCards: [],
					createdAt: 0,
					updatedAt: 0,
				},
			],
		});
		expect(warnings.some((warning) => warning.includes("dropped 1 unreadable initiative"))).toBe(
			true,
		);
		expect(board.roadmapProjects("p1").projects).toEqual([]);
		expect(readdirSync(join(root, "p1"))).toContain("projects.json.corrupt-42");
		const card = board.cards("p1")?.cards[0];
		for (const key of ["milestoneId", "pinnedStart", "estimateDays"])
			expect(card).not.toHaveProperty(key);
	});

	test("migrates a version-1 cards file on read: its roadmap `projectId` becomes `roadmapProjectId`", () => {
		const { root, store } = setup();
		mkdirSync(join(root, "p1"));
		const card = { id: "TR-1", title: "Old", category: "backlog", column: "backlog" };
		writeFileSync(
			join(root, "p1", "cards.json"),
			JSON.stringify({
				version: 1,
				prefix: "TR",
				nextNumber: 3,
				cards: [
					{ ...card, projectId: "P-1", milestoneId: "M-1" },
					{ ...card, id: "TR-2", roadmapProjectId: "P-9" },
				],
			}),
		);
		const board = store();
		const read = board.cards("p1");
		expect(read?.version).toBe(2);
		expect(read?.cards[0]).toMatchObject({ roadmapProjectId: "P-1", milestoneId: "M-1" });
		expect(read?.cards[0]).not.toHaveProperty("projectId");
		expect(read?.cards[1]).not.toHaveProperty("roadmapProjectId");
		if (read) board.saveCards("p1", read);
		const written = JSON.parse(readFileSync(join(root, "p1", "cards.json"), "utf8"));
		expect(written.version).toBe(2);
		expect(written.cards[0]).toMatchObject({ roadmapProjectId: "P-1", milestoneId: "M-1" });
		expect(written.cards[0]).not.toHaveProperty("projectId");
		expect(store().cards("p1")?.cards[0]).toMatchObject({ roadmapProjectId: "P-1" });
		expect(readdirSync(join(root, "p1"))).toEqual(["cards.json"]);
	});

	test("refuses roadmap files a newer ThinkRail wrote", () => {
		const { root, store } = setup();
		mkdirSync(join(root, "p1"));
		writeFileSync(
			join(root, "p1", "initiatives.json"),
			JSON.stringify({ version: 2, initiatives: [] }),
		);
		writeFileSync(join(root, "p1", "projects.json"), JSON.stringify({ version: 2, projects: [] }));
		expect(() => store().initiatives("p1")).toThrow(NewerBoardStoreError);
		expect(() => store().roadmapProjects("p1")).toThrow(NewerBoardStoreError);
	});

	test("refuses a project id that is not a plain folder name", () => {
		const { store } = setup();
		expect(() => store().cards("../escape")).toThrow("Not a project id");
	});
});
