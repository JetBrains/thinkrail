import { beforeAll, describe, expect, test } from "bun:test";
import type { AssistantMessage, UserMessage } from "@thinkrail/contracts";
import {
	type ComposerSuggestionsSource,
	composerSuggestionIndex,
	deriveComposerSuggestions,
} from "./composerSuggestions";
import { registerToolRenderer } from "./toolRegistry";
import type { ChatTurn, ToolResultState } from "./types";

beforeAll(() => {
	registerToolRenderer(
		"suggest_test",
		() => null,
		{
			composerSuggestions: (_args, result) =>
				(result as { details: { suggestions: string[] } }).details.suggestions,
		},
		"suggest-ext",
	);
	registerToolRenderer("ask_test", () => null, { interactive: true });
	registerToolRenderer("read_test", () => null);
});

const userTurn: ChatTurn = {
	kind: "user",
	id: "u1",
	message: { role: "user", content: "hi", timestamp: 0 } as UserMessage,
};

function assistantTurn(calls: Array<[id: string, name: string]>, streaming = false): ChatTurn {
	return {
		kind: "assistant",
		id: "a1",
		streaming,
		message: {
			role: "assistant",
			content: [
				{ type: "text", text: "Done." },
				...calls.map(([id, name]) => ({ type: "toolCall", id, name, arguments: {} })),
			],
			stopReason: "toolUse",
		} as unknown as AssistantMessage,
	};
}

const done = (suggestions: string[]): ToolResultState => ({
	status: "done",
	raw: { content: [], details: { suggestions } },
});

function source(overrides: Partial<ComposerSuggestionsSource> = {}): ComposerSuggestionsSource {
	return {
		turns: [userTurn, assistantTurn([["s1", "suggest_test"]])],
		toolResults: { s1: done(["Run the tests", "Open a PR"]) },
		isStreaming: false,
		queue: { steering: [], followUp: [] },
		...overrides,
	};
}

describe("deriveComposerSuggestions", () => {
	test("offers the suggestions of a finished turn's last call", () => {
		expect(deriveComposerSuggestions(source())).toEqual(["Run the tests", "Open a PR"]);
	});

	test("looks past the round closer a live settle appends", () => {
		const turns = [...source().turns, { kind: "system", id: "closer", endedAt: 1 } as ChatTurn];
		expect(deriveComposerSuggestions(source({ turns }))).toEqual(["Run the tests", "Open a PR"]);
	});

	test("offers nothing while streaming, with a queued message, or for a missing session", () => {
		expect(deriveComposerSuggestions(source({ isStreaming: true }))).toEqual([]);
		expect(
			deriveComposerSuggestions(source({ queue: { steering: [], followUp: ["next"] } })),
		).toEqual([]);
		expect(deriveComposerSuggestions(undefined)).toEqual([]);
	});

	test("offers nothing once anything follows the call", () => {
		for (const later of [
			{ ...userTurn, id: "u2" },
			{ kind: "error", id: "e1", text: "boom" } as ChatTurn,
			{ ...assistantTurn([]), id: "a2" },
		]) {
			expect(deriveComposerSuggestions(source({ turns: [...source().turns, later] }))).toEqual([]);
		}
	});

	test("offers nothing for an errored or unfinished call", () => {
		expect(
			deriveComposerSuggestions(source({ toolResults: { s1: { status: "error", raw: null } } })),
		).toEqual([]);
		expect(deriveComposerSuggestions(source({ toolResults: {} }))).toEqual([]);
		expect(
			deriveComposerSuggestions(
				source({ turns: [userTurn, assistantTurn([["s1", "suggest_test"]], true)] }),
			),
		).toEqual([]);
	});

	test("offers nothing beside a pending interaction or when the call is not last", () => {
		const withAsk = assistantTurn([
			["q1", "ask_test"],
			["s1", "suggest_test"],
		]);
		expect(deriveComposerSuggestions(source({ turns: [userTurn, withAsk] }))).toEqual([]);
		const suggestFirst = assistantTurn([
			["s1", "suggest_test"],
			["r1", "read_test"],
		]);
		expect(
			deriveComposerSuggestions(
				source({
					turns: [userTurn, suggestFirst],
					toolResults: { s1: done(["x"]), r1: { status: "done", raw: null } },
				}),
			),
		).toEqual([]);
	});

	test("offers nothing when the owning extension is switched off", () => {
		expect(deriveComposerSuggestions(source(), ["suggest-ext"])).toEqual([]);
	});
});

describe("composerSuggestionIndex", () => {
	const key = (
		code: string,
		mods: Partial<Record<"alt" | "ctrl" | "meta" | "shift", boolean>>,
	) => ({
		code,
		altKey: mods.alt ?? false,
		ctrlKey: mods.ctrl ?? false,
		metaKey: mods.meta ?? false,
		shiftKey: mods.shift ?? false,
	});

	test("maps Alt+Digit1…9 to a zero-based chip index", () => {
		expect(composerSuggestionIndex(key("Digit1", { alt: true }))).toBe(0);
		expect(composerSuggestionIndex(key("Digit9", { alt: true }))).toBe(8);
	});

	test("ignores other keys and modifier combinations", () => {
		expect(composerSuggestionIndex(key("Digit0", { alt: true }))).toBeNull();
		expect(composerSuggestionIndex(key("Digit1", {}))).toBeNull();
		expect(composerSuggestionIndex(key("Digit1", { alt: true, shift: true }))).toBeNull();
		expect(composerSuggestionIndex(key("Digit1", { alt: true, meta: true }))).toBeNull();
		expect(composerSuggestionIndex(key("KeyA", { alt: true }))).toBeNull();
	});
});
