import { afterEach, expect, test } from "bun:test";
import type { AssistantMessage, Message, UserMessage } from "@thinkrail/contracts";
import {
	extractFirstTurn,
	naiveChatTitle,
	naiveWorkspaceName,
	type OneShotRunner,
	setOneShotRunner,
	suggestChatTitle,
	suggestWorkspaceName,
	toWorkspaceName,
} from "./assist";

function fakeRunner(fn: OneShotRunner): void {
	setOneShotRunner(fn);
}

afterEach(() => setOneShotRunner(null));

function user(content: UserMessage["content"]): Message {
	return { role: "user", content, timestamp: 0 } as Message;
}
function assistant(text: string, stopReason: AssistantMessage["stopReason"] = "stop"): Message {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		api: "x",
		provider: "x",
		model: "x",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason,
		timestamp: 0,
	} as AssistantMessage as Message;
}

test("toWorkspaceName normalizes model output into a safe, bounded display name, preserving casing", () => {
	expect(toWorkspaceName('"Add Login Flow"')).toBe("Add Login Flow");
	expect(toWorkspaceName("`fix: the parser!!!`")).toBe("fix the parser");
	expect(toWorkspaceName("  Refactor   Auth  ")).toBe("Refactor Auth");
	expect(toWorkspaceName("one two three four five six")).toBe("one two three four five");
	expect(toWorkspaceName("Add OAuth login")).toBe("Add OAuth login");
	expect(toWorkspaceName("!!! ??? ...")).toBeNull();
	expect(toWorkspaceName("")).toBeNull();
});

test("naiveWorkspaceName derives a bounded Title Case name straight from the first prompt", () => {
	expect(naiveWorkspaceName("Let's figure out how to better implement")).toBe(
		"Let S Figure Out How",
	);
	expect(naiveWorkspaceName("refactor the workspace naming flow please")).toBe(
		"Refactor The Workspace Naming Flow",
	);
	expect(naiveWorkspaceName("  add a login form!!! ")).toBe("Add A Login Form");
});

test("naiveWorkspaceName grows short words to the minimum but never past the maxima", () => {
	expect(naiveWorkspaceName("a b c d e f g")).toBe("A B C D E");
	expect(naiveWorkspaceName("implement authentication authorization middleware refactor")).toBe(
		"Implement Authentication Authorization",
	);
	expect(naiveWorkspaceName("add login")).toBe("Add Login");
});

test("naiveWorkspaceName returns null for a blank or unusable prompt", () => {
	expect(naiveWorkspaceName("")).toBeNull();
	expect(naiveWorkspaceName("   ")).toBeNull();
	expect(naiveWorkspaceName("!!! ??? ...")).toBeNull();
});

test("extractFirstTurn pulls the first prompt + first assistant answer from a transcript", () => {
	const turn = extractFirstTurn([
		user("add a login flow"),
		assistant("Sure, here is the plan…"),
		user("now add tests"),
	]);
	expect(turn).toEqual({ prompt: "add a login flow", answer: "Sure, here is the plan…" });
});

test("extractFirstTurn reads array (multi-part) user content and tolerates a missing answer", () => {
	const turn = extractFirstTurn([
		user([
			{ type: "text", text: "please " },
			{ type: "text", text: "rename things" },
		]),
	]);
	expect(turn).toEqual({ prompt: "please rename things", answer: "" });
});

test("extractFirstTurn returns null when there is no user turn yet", () => {
	expect(extractFirstTurn([])).toBeNull();
	expect(extractFirstTurn([assistant("hi")])).toBeNull();
	expect(extractFirstTurn([user("   ")])).toBeNull();
});

test("extractFirstTurn skips killed turns — a retracted prompt is never naming material", () => {
	const turn = extractFirstTurn([
		user("refactor the billing engine"),
		assistant("Starting on billing…", "aborted"),
		user("fix the header layout"),
		assistant("Done — header fixed."),
	]);
	expect(turn).toEqual({ prompt: "fix the header layout", answer: "Done — header fixed." });
});

test("extractFirstTurn returns null when every turn was killed", () => {
	expect(
		extractFirstTurn([
			user("do a thing"),
			assistant("", "error"),
			user("try again"),
			assistant("", "aborted"),
		]),
	).toBeNull();
});

test("extractFirstTurn skips a killed multi-round turn by its terminal assistant message", () => {
	const turn = extractFirstTurn([
		user("first task"),
		assistant("let me look…"),
		assistant("", "aborted"),
		user("second task"),
		assistant("on it"),
	]);
	expect(turn).toEqual({ prompt: "second task", answer: "on it" });
});

test("suggestWorkspaceName runs the turn through the runner and normalizes the reply", async () => {
	let seen: string | undefined;
	fakeRunner(async (req) => {
		seen = req.prompt;
		return { text: "Add Login Flow", model: { provider: "p", id: "m" } };
	});
	const name = await suggestWorkspaceName({ prompt: "add a login flow", answer: "ok" });
	expect(name).toBe("Add Login Flow");
	expect(seen).toContain("add a login flow");
	expect(seen).toContain("ok");
});

test("suggestWorkspaceName degrades to null on a runner failure (never throws)", async () => {
	fakeRunner(async () => {
		throw new Error("no-model");
	});
	expect(await suggestWorkspaceName({ prompt: "do a thing", answer: "" })).toBeNull();
});

test("suggestWorkspaceName returns null without calling the runner when there's no prompt", async () => {
	let called = false;
	fakeRunner(async () => {
		called = true;
		return { text: "x", model: { provider: "p", id: "m" } };
	});
	expect(await suggestWorkspaceName({ prompt: "   ", answer: "answer" })).toBeNull();
	expect(called).toBe(false);
});

test("naiveChatTitle preserves useful prompt text within six words and 48 characters", () => {
	expect(naiveChatTitle("  Fix OAuth 2.0 / PKCE redirect handling today  ")).toBe(
		"Fix OAuth 2.0 / PKCE redirect",
	);
	expect(naiveChatTitle("authenticationauthorizationtoken should stay bounded")).toBe(
		"authenticationauthorizationtoken should stay",
	);
	expect(naiveChatTitle(" \n !!! ??? \t")).toBeNull();
});

test("suggestChatTitle sends only bounded first-prompt text through the tool-free one-shot runner", async () => {
	let request: Parameters<OneShotRunner>[0] | undefined;
	fakeRunner(async (input) => {
		request = input;
		return { text: '"Fix OAuth 2.0 / PKCE"', model: { provider: "p", id: "m" } };
	});
	const marker = "TAIL_MUST_BE_CLIPPED";
	const title = await suggestChatTitle(`repair login ${"x".repeat(2000)}${marker}`);
	expect(title).toBe("Fix OAuth 2.0 / PKCE");
	expect(request?.tier).toBe("cheap");
	expect(request?.maxTokens).toBe(32);
	expect(request?.system).toContain("untrusted");
	expect(request?.prompt).toContain("repair login");
	expect(request?.prompt).not.toContain(marker);
	expect(request?.prompt.length).toBeLessThan(1700);
	expect(request?.signal).toBeInstanceOf(AbortSignal);
});

test("suggestChatTitle normalizes model formatting and defensively bounds output", async () => {
	fakeRunner(async () => ({
		text: "`Preserve C++\nParser   Semantics`",
		model: { provider: "p", id: "m" },
	}));
	expect(await suggestChatTitle("fix parser")).toBe("Preserve C++ Parser Semantics");

	fakeRunner(async () => ({ text: "word ".repeat(30), model: { provider: "p", id: "m" } }));
	const bounded = await suggestChatTitle("fix parser");
	expect(bounded?.length).toBeLessThanOrEqual(80);

	fakeRunner(async () => ({ text: "!!! ???", model: { provider: "p", id: "m" } }));
	expect(await suggestChatTitle("fix parser")).toBeNull();
});

test("suggestChatTitle degrades without invoking the runner for blank input", async () => {
	let called = false;
	fakeRunner(async () => {
		called = true;
		throw new Error("no-model");
	});
	expect(await suggestChatTitle(" \n ")).toBeNull();
	expect(called).toBe(false);
	expect(await suggestChatTitle("fix parser")).toBeNull();
});
