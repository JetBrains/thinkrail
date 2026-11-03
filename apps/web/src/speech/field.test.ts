import { expect, test } from "bun:test";
import { type FieldCandidate, isDictationField } from "./field";

function field(
	tagName: string,
	extra: {
		type?: string;
		readOnly?: boolean;
		disabled?: boolean;
		isContentEditable?: boolean;
		inside?: string;
	} = {},
): FieldCandidate {
	const { inside, ...rest } = extra;
	return {
		tagName,
		...rest,
		closest: (selector: string) => (inside && selector.includes(inside) ? {} : null),
	};
}

test("text inputs, textareas and contenteditable regions are dictation fields", () => {
	for (const type of ["text", "search", "url", "email", "tel", ""]) {
		expect(isDictationField(field("INPUT", { type }))).toBe(true);
	}
	expect(isDictationField(field("INPUT"))).toBe(true);
	expect(isDictationField(field("TEXTAREA"))).toBe(true);
	expect(isDictationField(field("DIV", { isContentEditable: true }))).toBe(true);
});

test("non-text inputs, read-only or disabled fields, the editor and the terminal are not", () => {
	for (const type of ["password", "number", "date", "checkbox", "range", "file", "hidden"]) {
		expect(isDictationField(field("INPUT", { type }))).toBe(false);
	}
	expect(isDictationField(field("INPUT", { readOnly: true }))).toBe(false);
	expect(isDictationField(field("INPUT", { disabled: true }))).toBe(false);
	expect(isDictationField(field("TEXTAREA", { inside: ".monaco-editor" }))).toBe(false);
	expect(isDictationField(field("TEXTAREA", { inside: ".xterm" }))).toBe(false);
	expect(isDictationField(field("DIV"))).toBe(false);
});
