import { describe, expect, test } from "bun:test";
import { type EscapePress, type FieldTarget, leavesField, parkingSpot } from "./escapeLeavesField";

const ESCAPE: EscapePress = {
	key: "Escape",
	altKey: false,
	ctrlKey: false,
	metaKey: false,
	shiftKey: false,
	isComposing: false,
	keyCode: 27,
	defaultPrevented: false,
};

const field = (
	tagName: string,
	{
		type,
		editable = false,
		inside = [],
	}: { type?: string; editable?: boolean; inside?: string[] } = {},
): FieldTarget => ({
	tagName,
	isContentEditable: editable,
	...(type === undefined ? {} : { type }),
	closest: (selector) =>
		selector.split(", ").some((part) => inside.includes(part)) ? { selector } : null,
});

const leaves = (target: FieldTarget, press: Partial<EscapePress> = {}, claimed = false) =>
	leavesField({ ...ESCAPE, ...press }, target, claimed);

describe("a bare Esc leaves a text field", () => {
	test("in a textarea, a text-like input or contenteditable", () => {
		expect(leaves(field("TEXTAREA"))).toBe(true);
		for (const type of ["text", "search", "url", "email", "number", "password", "tel"]) {
			expect(leaves(field("INPUT", { type })), type).toBe(true);
		}
		expect(leaves(field("DIV", { editable: true }))).toBe(true);
	});

	test("not in a select, a checkbox-like input or a plain element", () => {
		expect(leaves(field("SELECT"))).toBe(false);
		for (const type of ["checkbox", "radio", "range", "color", "file", "button", "date"]) {
			expect(leaves(field("INPUT", { type })), type).toBe(false);
		}
		expect(leaves(field("DIV"))).toBe(false);
		expect(leaves(field("BUTTON", { type: "button" }))).toBe(false);
	});

	test("not in Monaco or the terminal, which keep their Esc", () => {
		expect(leaves(field("TEXTAREA", { inside: [".monaco-editor"] }))).toBe(false);
		expect(leaves(field("INPUT", { type: "text", inside: [".monaco-editor"] }))).toBe(false);
		expect(leaves(field("TEXTAREA", { inside: [".xterm"] }))).toBe(false);
	});

	test("not inside a dialog or an open menu, which Esc keeps closing", () => {
		for (const layer of [
			'[aria-modal="true"]',
			'[role="dialog"][data-state="open"]',
			'[role="alertdialog"][data-state="open"]',
			'[role="menu"][data-state="open"]',
		]) {
			expect(leaves(field("INPUT", { type: "text", inside: [layer] })), layer).toBe(false);
		}
	});

	test("not when an owner already took it, a modifier is held, an IME composes or a claim holds", () => {
		const textarea = field("TEXTAREA");
		expect(leaves(textarea, { defaultPrevented: true })).toBe(false);
		expect(leaves(textarea, { shiftKey: true })).toBe(false);
		expect(leaves(textarea, { altKey: true })).toBe(false);
		expect(leaves(textarea, { ctrlKey: true })).toBe(false);
		expect(leaves(textarea, { metaKey: true })).toBe(false);
		expect(leaves(textarea, { isComposing: true })).toBe(false);
		expect(leaves(textarea, { keyCode: 229 })).toBe(false);
		expect(leaves(textarea, {}, true)).toBe(false);
		expect(leaves(textarea, { key: "Enter" })).toBe(false);
	});
});

describe("where the leave lands", () => {
	const focusable = (shown: ReadonlySet<string>) => (candidate: string) => shown.has(candidate);

	test("the region's focusable park first", () => {
		expect(parkingSpot(["feed"], "region", focusable(new Set(["feed", "region"])))).toBe("feed");
		expect(parkingSpot(["hidden", "feed"], "region", focusable(new Set(["feed", "region"])))).toBe(
			"feed",
		);
	});

	test("else the region root, else nowhere", () => {
		expect(parkingSpot(["feed"], "region", focusable(new Set(["region"])))).toBe("region");
		expect(parkingSpot([], "region", focusable(new Set(["region"])))).toBe("region");
		expect(parkingSpot([], "region", focusable(new Set()))).toBeNull();
	});
});
