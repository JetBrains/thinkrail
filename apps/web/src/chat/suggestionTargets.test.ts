import { describe, expect, test } from "bun:test";
import { matchKeybinding, resolveKeybindings } from "@/keybindings";
import {
	registerSuggestionTarget,
	runSuggestion,
	type SuggestionTarget,
	suggestionAt,
	suggestionKeyAction,
	suggestionTargetFor,
} from "./suggestionTargets";

const node = (name: string) => ({ name }) as unknown as Node;

const target = (
	sessionId: string,
	inside: readonly Node[],
	suggestions: readonly string[],
	log: string[] = [],
): SuggestionTarget => ({
	sessionId,
	root: { contains: (other) => other !== null && inside.includes(other) },
	suggestions,
	send: (text) => log.push(`send ${sessionId}: ${text}`),
	edit: (text) => log.push(`edit ${sessionId}: ${text}`),
});

const press = (code: string, modifiers: { alt?: boolean; shift?: boolean } = {}) => ({
	code,
	key: code.replace("Digit", ""),
	altKey: modifiers.alt ?? false,
	shiftKey: modifiers.shift ?? false,
	ctrlKey: false,
	metaKey: false,
});

describe("the next-step keys", () => {
	test("Alt+N sends chip N and Shift+Alt+N edits it, through the resolved global table", () => {
		const keybindings = resolveKeybindings({ platform: "Linux" });
		const action = (code: string, modifiers?: { alt?: boolean; shift?: boolean }) =>
			suggestionKeyAction(matchKeybinding(keybindings, press(code, modifiers)));
		expect(action("Digit1", { alt: true })).toEqual({ index: 0, edit: false });
		expect(action("Digit9", { alt: true, shift: true })).toEqual({ index: 8, edit: true });
		expect(action("Digit1")).toBeNull();
		expect(action("Digit0", { alt: true })).toBeNull();
		expect(action("KeyA", { alt: true })).toBeNull();
		expect(suggestionKeyAction(null)).toBeNull();
		expect(suggestionKeyAction("focus.composer")).toBeNull();
	});
});

describe("which chat a next-step key acts in", () => {
	const inA = node("composer A");
	const inB = node("tree row of B");
	const outside = node("files tree");
	const a = target("a", [inA], ["Run the tests", "Open a PR"]);
	const b = target("b", [inB], []);

	test("the chat holding focus, even when it has no chip", () => {
		expect(suggestionTargetFor(inA, "b", [a, b])).toBe(a);
		expect(suggestionTargetFor(inB, "a", [a, b])).toBe(b);
	});

	test("else the main area's chat, else none", () => {
		expect(suggestionTargetFor(outside, "a", [a, b])).toBe(a);
		expect(suggestionTargetFor(null, "a", [a, b])).toBe(a);
		expect(suggestionTargetFor(outside, "c", [a, b])).toBeNull();
		expect(suggestionTargetFor(outside, null, [a, b])).toBeNull();
	});

	test("a chip that is not shown is no chip: past the list or past nine", () => {
		expect(suggestionAt(a, 1)).toBe("Open a PR");
		expect(suggestionAt(a, 2)).toBeUndefined();
		expect(suggestionAt(b, 0)).toBeUndefined();
		expect(suggestionAt(null, 0)).toBeUndefined();
		const twelve = target(
			"t",
			[],
			Array.from({ length: 12 }, (_, i) => `Step ${i + 1}`),
		);
		expect(suggestionAt(twelve, 8)).toBe("Step 9");
		expect(suggestionAt(twelve, 9)).toBeUndefined();
	});

	test("runs the send or the edit of the chip, and nothing without one", () => {
		const log: string[] = [];
		const chat = target("a", [], ["Run the tests", "Open a PR"], log);
		expect(runSuggestion(chat, { index: 1, edit: false })).toBe(true);
		expect(runSuggestion(chat, { index: 0, edit: true })).toBe(true);
		expect(runSuggestion(chat, { index: 2, edit: false })).toBe(false);
		expect(log).toEqual(["send a: Open a PR", "edit a: Run the tests"]);
	});

	test("a mounted chat registers until it unmounts; a re-registered one is the latest", () => {
		const outsideAll = node("nowhere");
		const first = target("a", [], ["old"]);
		const second = target("a", [], ["new"]);
		const dropFirst = registerSuggestionTarget(first);
		expect(suggestionTargetFor(outsideAll, "a")).toBe(first);
		const dropSecond = registerSuggestionTarget(second);
		expect(suggestionTargetFor(outsideAll, "a")).toBe(second);
		dropSecond();
		expect(suggestionTargetFor(outsideAll, "a")).toBe(first);
		dropFirst();
		expect(suggestionTargetFor(outsideAll, "a")).toBeNull();
	});
});
