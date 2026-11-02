import { expect, test } from "bun:test";
import { dictationText, spokenText } from "./text";

test("finals and the live partial join with single spaces", () => {
	expect(spokenText([], "")).toBe("");
	expect(spokenText(["Open the store."], " and add")).toBe("Open the store. and add");
	expect(spokenText(["One.", "Two."], "")).toBe("One. Two.");
});

test("dictating into an empty field writes the text with the caret at its end", () => {
	expect(dictationText({ base: "", start: 0, end: 0 }, "Hello there")).toEqual({
		text: "Hello there",
		caret: 11,
	});
});

test("dictation after existing text gets a separating space", () => {
	expect(dictationText({ base: "Refactor", start: 8, end: 8 }, "the store")).toEqual({
		text: "Refactor the store",
		caret: 18,
	});
	expect(dictationText({ base: "Refactor ", start: 9, end: 9 }, "the store").text).toBe(
		"Refactor the store",
	);
	expect(dictationText({ base: "@", start: 1, end: 1 }, "appStore.ts").text).toBe("@appStore.ts");
});

test("dictation in the middle replaces the selection and spaces both sides", () => {
	const anchor = { base: "Fix the bug now", start: 8, end: 11 };
	expect(dictationText(anchor, "crash")).toEqual({ text: "Fix the crash now", caret: 13 });
	expect(dictationText({ base: "Fix it.", start: 6, end: 6 }, "today").text).toBe("Fix it today.");
});

test("no speech leaves the field as it was, minus the replaced selection", () => {
	expect(dictationText({ base: "keep", start: 4, end: 4 }, "")).toEqual({ text: "keep", caret: 4 });
	expect(dictationText({ base: "a bc d", start: 2, end: 4 }, "")).toEqual({
		text: "a  d",
		caret: 2,
	});
});
