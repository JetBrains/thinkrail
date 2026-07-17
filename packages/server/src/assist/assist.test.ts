import { afterEach, expect, test } from "bun:test";
import type { AssistantMessage, Message, UserMessage } from "@thinkrail/contracts";
import {
	extractFirstTurn,
	naiveWorkspaceName,
	type OneShotRunner,
	setOneShotRunner,
	suggestWorkspaceName,
	toWorkspaceName,
} from "./assist";

/** Inject a fake one-shot runner returning a fixed text (or throwing) — no pi/auth/network. */
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
	expect(toWorkspaceName('"Add Login Flow"')).toBe("Add Login Flow"); // wrapping quotes stripped
	expect(toWorkspaceName("`fix: the parser!!!`")).toBe("fix the parser"); // backticks + punctuation gone
	expect(toWorkspaceName("  Refactor   Auth  ")).toBe("Refactor Auth"); // whitespace collapsed
	expect(toWorkspaceName("one two three four five six")).toBe("one two three four five"); // ≤5 words
	expect(toWorkspaceName("Add OAuth login")).toBe("Add OAuth login"); // acronym casing survives
	expect(toWorkspaceName("!!! ??? ...")).toBeNull(); // nothing usable
	expect(toWorkspaceName("")).toBeNull();
});

test("naiveWorkspaceName derives a bounded Title Case name straight from the first prompt", () => {
	// Word-boundary growth stops at the 5-word cap; apostrophes split into separate words.
	expect(naiveWorkspaceName("Let's figure out how to better implement")).toBe(
		"Let S Figure Out How",
	);
	expect(naiveWorkspaceName("refactor the workspace naming flow please")).toBe(
		"Refactor The Workspace Naming Flow",
	);
	// Punctuation collapses to spaces; leading/trailing junk is trimmed; each word is Title Cased.
	expect(naiveWorkspaceName("  add a login form!!! ")).toBe("Add A Login Form");
});

test("naiveWorkspaceName grows short words to the minimum but never past the maxima", () => {
	// A run of very short words keeps growing until ~10 chars / 2 words is met.
	expect(naiveWorkspaceName("a b c d e f g")).toBe("A B C D E"); // 5-word cap
	// Long words stop before the 40-char cap once the minimum (2 words / 10 chars) is met.
	expect(naiveWorkspaceName("implement authentication authorization middleware refactor")).toBe(
		"Implement Authentication Authorization",
	);
	// A prompt shorter than the minimum simply uses what it has (words ran out).
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
		user("refactor the billing engine"), // aborted a second later — wrong workspace
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
		assistant("let me look…"), // pre-tool preamble stopped clean…
		assistant("", "aborted"), // …but the run's terminal message was the abort
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
	expect(name).toBe("Add Login Flow"); // display name, casing preserved
	expect(seen).toContain("add a login flow"); // the prompt carried the turn
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
