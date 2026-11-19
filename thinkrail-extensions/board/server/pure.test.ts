import { describe, expect, test } from "bun:test";
import { allocatePrefix, cardId, parseCardId, prefixCandidates } from "./ids";
import { BRAINSTORMING_COMMAND, kickoffText, workflowFor } from "./kickoff";
import type { Card, Category } from "./model";
import { columnFor, columnOfCard, columnsOf, placeInColumn } from "./presets";

describe("card ids", () => {
	test("derive a 2–4 letter prefix from the project name", () => {
		expect(prefixCandidates("ThinkRail")[0]).toBe("TR");
		expect(prefixCandidates("my-cool-app")[0]).toBe("MCA");
		expect(prefixCandidates("the quick brown fox jumps")[0]).toBe("TQBF");
		expect(prefixCandidates("board")[0]).toBe("BOA");
		expect(prefixCandidates("Ünïcode Prøject")[0]).toBe("UP");
		expect(prefixCandidates("")).toEqual(["BD"]);
		expect(prefixCandidates("x")).toEqual(["BD"]);
		expect(prefixCandidates("42")).toEqual(["BD"]);
		for (const name of ["ThinkRail", "board", "my-cool-app", "a b c d e f"])
			for (const candidate of prefixCandidates(name)) expect(candidate).toMatch(/^[A-Z]{2,4}$/);
	});

	test("never reuse another board's prefix", () => {
		expect(allocatePrefix("ThinkRail", new Set())).toBe("TR");
		expect(allocatePrefix("ThinkRail", new Set(["TR"]))).toBe("TRH");
		const all = new Set(prefixCandidates("ThinkRail"));
		const fallback = allocatePrefix("ThinkRail", all);
		expect(fallback).toMatch(/^TR[A-Z]{2}$/);
		expect(all.has(fallback)).toBe(false);
		expect(allocatePrefix("", new Set(["BD"]))).toBe("BDAA");
	});

	test("parse card ids case-insensitively and nothing else", () => {
		expect(cardId("TR", 142)).toBe("TR-142");
		expect(parseCardId(" tr-142 ")).toEqual({ prefix: "TR", number: 142 });
		for (const bad of ["TR", "TR-0", "T-1", "TOOLONG-1", "TR-1x", "../TR-1"])
			expect(parseCardId(bad)).toBeNull();
	});
});

describe("presets", () => {
	test("map the columns onto the fixed categories, Triage and Canceled off the board", () => {
		const visible = (preset: "agentic-kanban" | "solo") =>
			columnsOf(preset)
				.filter((column) => !column.hidden)
				.map((column) => [column.id, column.categories.join("+")]);
		expect(visible("agentic-kanban")).toEqual([
			["backlog", "backlog"],
			["ready", "unstarted"],
			["designing", "started"],
			["building", "started"],
			["review", "review"],
			["done", "completed"],
		]);
		expect(visible("solo")).toEqual([
			["todo", "backlog+unstarted"],
			["doing", "started+review"],
			["done", "completed"],
		]);
		for (const preset of ["agentic-kanban", "solo"] as const)
			expect(
				columnsOf(preset)
					.filter((column) => column.hidden)
					.map((column) => column.id),
			).toEqual(["triage", "canceled"]);
	});

	test("place every category in exactly one column, a started card by its workflow", () => {
		const categories: Category[] = [
			"triage",
			"backlog",
			"unstarted",
			"started",
			"review",
			"completed",
			"canceled",
		];
		expect(categories.map((category) => columnFor("agentic-kanban", category))).toEqual([
			"triage",
			"backlog",
			"ready",
			"building",
			"review",
			"done",
			"canceled",
		]);
		expect(columnFor("agentic-kanban", "started", "brainstorm")).toBe("designing");
		expect(categories.map((category) => columnFor("solo", category))).toEqual([
			"triage",
			"todo",
			"todo",
			"doing",
			"doing",
			"done",
			"canceled",
		]);
		expect(
			columnOfCard("agentic-kanban", {
				category: "started",
				attempts: [
					{ workspaceId: "w", sessionId: "s", workflow: "brainstorm", startedAt: 0, notes: [] },
				],
			}),
		).toBe("designing");
	});

	test("a move keeps a category the column shows and otherwise takes the column's first", () => {
		expect(placeInColumn("solo", { category: "review" }, "doing")).toEqual({
			category: "review",
			column: "doing",
		});
		expect(placeInColumn("solo", { category: "completed" }, "doing")).toEqual({
			category: "started",
			column: "doing",
		});
		expect(placeInColumn("agentic-kanban", { category: "started" }, "designing")).toEqual({
			category: "started",
			column: "designing",
		});
		expect(placeInColumn("agentic-kanban", { category: "backlog" }, "canceled")).toEqual({
			category: "canceled",
			column: "canceled",
		});
		expect(placeInColumn("solo", { category: "backlog" }, "ready")).toBeNull();
	});
});

describe("kickoff", () => {
	const card: Pick<Card, "id" | "title" | "description" | "acceptance" | "specRefs"> = {
		id: "TR-7",
		title: " Board inbox ",
		description: "Show the cards that wait for you.\n",
		acceptance: ["Lists waiting cards", " ", "Across projects"],
		specRefs: ["module-ext-board"],
	};

	test("S cards, bugs and unsized cards implement; M and L brainstorm first", () => {
		expect(workflowFor({ type: "feature", size: "S" })).toBe("implement");
		expect(workflowFor({ type: "feature" })).toBe("implement");
		expect(workflowFor({ type: "bug", size: "L" })).toBe("implement");
		expect(workflowFor({ type: "feature", size: "M" })).toBe("brainstorm");
		expect(workflowFor({ type: "chore", size: "L" })).toBe("brainstorm");
	});

	test("builds the prompt from the card and invokes brainstorming the way the composer sends a skill", () => {
		const body = [
			"Card TR-7: Board inbox",
			"",
			"Show the cards that wait for you.",
			"",
			"Acceptance criteria:",
			"- Lists waiting cards",
			"- Across projects",
			"",
			"Specs:",
			"- module-ext-board",
		].join("\n");
		expect(kickoffText(card, "implement")).toBe(body);
		expect(kickoffText(card, "brainstorm")).toBe(`${BRAINSTORMING_COMMAND} ${body}`);
		expect(BRAINSTORMING_COMMAND).toBe("/skill:brainstorming");
		expect(
			kickoffText({ ...card, description: "", acceptance: [], specRefs: [] }, "implement"),
		).toBe("Card TR-7: Board inbox");
	});
});
