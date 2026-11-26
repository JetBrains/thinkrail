import { beforeAll, describe, expect, test } from "bun:test";
import type { AssistantMessage, UserMessage } from "@thinkrail/contracts";
import { type ComposerSuggestionsSource, deriveComposerSuggestions } from "./composerSuggestions";
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
			stopReason: calls.length > 0 ? "toolUse" : "stop",
		} as unknown as AssistantMessage,
	};
}

const finalAnswer = (overrides: Partial<AssistantMessage> = {}, streaming = false): ChatTurn => {
	const turn = assistantTurn([], streaming) as Extract<ChatTurn, { kind: "assistant" }>;
	return { ...turn, id: "a2", message: { ...turn.message, ...overrides } };
};

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

	test("keeps the suggestions through the final message written after the call", () => {
		const turns = [...source().turns, finalAnswer(), { kind: "system", id: "closer" } as ChatTurn];
		expect(deriveComposerSuggestions(source({ turns }))).toEqual(["Run the tests", "Open a PR"]);
	});

	test("offers nothing once anything but a finished final message follows the call", () => {
		for (const later of [
			{ ...userTurn, id: "u2" },
			{ kind: "error", id: "e1", text: "boom" } as ChatTurn,
			{ ...assistantTurn([["r1", "read_test"]]), id: "a2" },
			finalAnswer({ stopReason: "error" }),
			finalAnswer({}, true),
		]) {
			expect(deriveComposerSuggestions(source({ turns: [...source().turns, later] }))).toEqual([]);
		}
	});

	test("a final message alone offers nothing", () => {
		expect(deriveComposerSuggestions(source({ turns: [userTurn, finalAnswer()] }))).toEqual([]);
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
