import { describe, expect, test } from "bun:test";
import type { EscapePress } from "./escapeLeavesField";
import { closesPeek } from "./peekControl";

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

const inside = (...selectors: string[]) => ({
	closest: (selector: string) =>
		selector.split(", ").some((part) => selectors.includes(part)) ? { selector } : null,
});

const closes = (press: Partial<EscapePress> = {}, target = inside(), claimed = false) =>
	closesPeek({ ...ESCAPE, ...press }, target, claimed);

describe("a bare Esc nobody took closes Peek", () => {
	test("on the parked feed, Peek itself or with focus nowhere", () => {
		expect(closes()).toBe(true);
		expect(closesPeek(ESCAPE, null, false)).toBe(true);
	});

	test("not when a field, menu or overlay owner already took it", () => {
		expect(closes({ defaultPrevented: true })).toBe(false);
	});

	test("not with a modifier, during IME composition or under a keyboard claim", () => {
		expect(closes({ shiftKey: true })).toBe(false);
		expect(closes({ altKey: true })).toBe(false);
		expect(closes({ ctrlKey: true })).toBe(false);
		expect(closes({ metaKey: true })).toBe(false);
		expect(closes({ isComposing: true })).toBe(false);
		expect(closes({ keyCode: 229 })).toBe(false);
		expect(closes({}, inside(), true)).toBe(false);
		expect(closes({ key: "Enter" })).toBe(false);
	});

	test("not inside Monaco, a terminal, a dialog or an open menu", () => {
		expect(closes({}, inside(".monaco-editor"))).toBe(false);
		expect(closes({}, inside(".xterm"))).toBe(false);
		expect(closes({}, inside('[role="dialog"][data-state="open"]'))).toBe(false);
		expect(closes({}, inside('[role="menu"][data-state="open"]'))).toBe(false);
	});
});
