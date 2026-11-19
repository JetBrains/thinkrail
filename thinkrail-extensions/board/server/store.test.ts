import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_SETTINGS } from "./model";
import { BoardStore, type CardsFile, NewerBoardStoreError } from "./store";

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
	version: 1,
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
			version: 1,
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
		writeFileSync(join(root, "p1", "cards.json"), JSON.stringify({ version: 2, cards: [] }));
		expect(() => store().cards("p1")).toThrow(NewerBoardStoreError);
		expect(readdirSync(join(root, "p1"))).toEqual(["cards.json"]);
	});

	test("refuses a project id that is not a plain folder name", () => {
		const { store } = setup();
		expect(() => store().cards("../escape")).toThrow("Not a project id");
	});
});
