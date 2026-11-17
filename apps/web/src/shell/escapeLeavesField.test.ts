import { describe, expect, test } from "bun:test";
import {
	climbsToMain,
	type EscapePress,
	type EscapeTarget,
	leavesField,
} from "./escapeLeavesField";

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
		is = [],
	}: { type?: string; editable?: boolean; inside?: string[]; is?: string[] } = {},
): EscapeTarget => ({
	tagName,
	isContentEditable: editable,
	...(type === undefined ? {} : { type }),
	closest: (selector) =>
		selector.split(", ").some((part) => inside.includes(part) || is.includes(part))
			? { selector }
			: null,
	matches: (selector) => selector.split(", ").some((part) => is.includes(part)),
});

const leaves = (target: EscapeTarget, press: Partial<EscapePress> = {}, claimed = false) =>
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

const REGION = "[data-region]";
const CENTER = '[data-region-kind="center"]';
const CENTER_CONTENT = '[data-region-kind="center"] > [role="tabpanel"]';
const LADDER_ORIGIN = "[data-esc-ladder]";
const inSide = (tagName: string, init: { type?: string; inside?: string[]; is?: string[] } = {}) =>
	field(tagName, { ...init, inside: [REGION, ...(init.inside ?? [])] });
const climbs = (target: EscapeTarget, press: Partial<EscapePress> = {}, claimed = false) =>
	climbsToMain({ ...ESCAPE, ...press }, target, claimed);

describe("a bare Esc on a panel climbs to the main area", () => {
	test("from a panel root, a tree row, a tab, a rail or list button and a checkbox outside the center", () => {
		expect(climbs(field("SECTION", { is: [REGION] }))).toBe(true);
		expect(climbs(inSide("DIV", { inside: ['[role="tree"]'] }))).toBe(true);
		expect(climbs(inSide("BUTTON", { inside: ['[role="tablist"]'] }))).toBe(true);
		expect(climbs(inSide("BUTTON", { inside: ['[role="toolbar"]'] }))).toBe(true);
		expect(climbs(inSide("BUTTON"))).toBe(true);
		expect(climbs(inSide("INPUT", { type: "checkbox" }))).toBe(true);
	});

	test("from the center's own tab strip, into its content", () => {
		expect(climbs(field("BUTTON", { inside: [REGION, CENTER, '[role="tablist"]'] }))).toBe(true);
		expect(climbs(field("BUTTON", { inside: [REGION, CENTER] }))).toBe(true);
	});

	test("from an auxiliary rail's control, which sits outside every region", () => {
		expect(climbs(field("BUTTON", { inside: [LADDER_ORIGIN, '[role="toolbar"]'] }))).toBe(true);
		expect(climbs(field("DIV", { is: [LADDER_ORIGIN] }))).toBe(true);
	});

	test("never inside the main area: its root, its content, or outside every region", () => {
		expect(climbs(field("SECTION", { is: [REGION, CENTER] }))).toBe(false);
		expect(climbs(field("DIV", { inside: [REGION, CENTER, CENTER_CONTENT] }))).toBe(false);
		expect(climbs(field("ARTICLE", { inside: [REGION, CENTER, CENTER_CONTENT] }))).toBe(false);
		expect(climbs(field("BUTTON"))).toBe(false);
	});

	test("never from a text field, a select, the terminal or Monaco, which keep their Esc", () => {
		expect(climbs(inSide("TEXTAREA"))).toBe(false);
		expect(climbs(inSide("INPUT", { type: "search" }))).toBe(false);
		expect(climbs(inSide("SELECT"))).toBe(false);
		expect(climbs(field("DIV", { editable: true, inside: [REGION] }))).toBe(false);
		expect(climbs(inSide("TEXTAREA", { inside: [".xterm"] }))).toBe(false);
		expect(climbs(inSide("DIV", { inside: [".xterm"] }))).toBe(false);
		expect(climbs(inSide("DIV", { inside: [".monaco-editor"] }))).toBe(false);
	});

	test("never inside a dialog or an open menu", () => {
		for (const layer of [
			'[aria-modal="true"]',
			'[role="dialog"][data-state="open"]',
			'[role="alertdialog"][data-state="open"]',
			'[role="menu"][data-state="open"]',
		]) {
			expect(climbs(inSide("BUTTON", { inside: [layer] })), layer).toBe(false);
		}
	});

	test("never when an owner took it, a modifier is held, an IME composes or a claim holds", () => {
		const row = inSide("DIV", { inside: ['[role="tree"]'] });
		expect(climbs(row, { defaultPrevented: true })).toBe(false);
		expect(climbs(row, { shiftKey: true })).toBe(false);
		expect(climbs(row, { altKey: true })).toBe(false);
		expect(climbs(row, { ctrlKey: true })).toBe(false);
		expect(climbs(row, { metaKey: true })).toBe(false);
		expect(climbs(row, { isComposing: true })).toBe(false);
		expect(climbs(row, { keyCode: 229 })).toBe(false);
		expect(climbs(row, {}, true)).toBe(false);
		expect(climbs(row, { key: "Enter" })).toBe(false);
	});
});
