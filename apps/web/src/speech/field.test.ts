import { expect, test } from "bun:test";
import { type FieldCandidate, isDictationField } from "./field";

const field = (over: Partial<FieldCandidate> & { inside?: string }): FieldCandidate => ({
	tagName: "INPUT",
	type: "text",
	closest: (selector: string) => (over.inside && selector.includes(over.inside) ? {} : null),
	...over,
});

test("text inputs, textareas and contenteditable regions are dictation fields", () => {
	for (const type of ["text", "search", "url", "email", "tel", ""]) {
		expect(isDictationField(field({ type }))).toBe(true);
	}
	expect(isDictationField(field({ tagName: "TEXTAREA", type: undefined }))).toBe(true);
	expect(
		isDictationField(field({ tagName: "DIV", type: undefined, isContentEditable: true })),
	).toBe(true);
});

test("non-text inputs, read-only or disabled fields, the editor and the terminal are not", () => {
	for (const type of ["password", "number", "date", "checkbox", "range", "file", "hidden"]) {
		expect(isDictationField(field({ type }))).toBe(false);
	}
	expect(isDictationField(field({ readOnly: true }))).toBe(false);
	expect(isDictationField(field({ disabled: true }))).toBe(false);
	expect(isDictationField(field({ tagName: "TEXTAREA", inside: ".monaco-editor" }))).toBe(false);
	expect(isDictationField(field({ tagName: "TEXTAREA", inside: ".xterm" }))).toBe(false);
	expect(isDictationField(field({ tagName: "DIV", type: undefined }))).toBe(false);
});
