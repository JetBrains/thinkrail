import { describe, expect, it } from "bun:test";
import {
	createQuestionAttentionClaim,
	type FocusedNode,
	focusTargetKind,
	isKeyboardFocused,
	revealDelta,
	shouldClaimQuestionFocus,
	shouldFocusPageTarget,
	watchInputModality,
} from "./focus";

const page: { body: unknown; documentElement: unknown } = { body: null, documentElement: null };

interface NodeInit {
	readonly attributes?: Record<string, string>;
	readonly value?: string;
	readonly editable?: boolean;
	readonly within?: readonly string[];
}

const node = (
	tagName: string,
	{ attributes = {}, value, editable, within = [] }: NodeInit = {},
) => ({
	ownerDocument: page,
	tagName,
	value,
	isContentEditable: editable ?? false,
	getAttribute: (name: string) => attributes[name] ?? null,
	closest: (selectors: string) =>
		selectors
			.split(",")
			.map((selector) => selector.trim())
			.some((selector) => selector === tagName.toLowerCase() || within.includes(selector))
			? {}
			: null,
});
const body = node("BODY");
page.body = body;
const composer = (value: string) =>
	node("TEXTAREA", { attributes: { "data-testid": "chat-input" }, value });
const kind = (active: FocusedNode | null, { inside = false, keyboard = false } = {}) =>
	focusTargetKind(active, inside, keyboard);
const claims = (active: FocusedNode | null, keyboard = false) =>
	shouldClaimQuestionFocus(kind(active, { keyboard }), false, true);

describe("where a question's focus claim may land", () => {
	it("tells <body>, the card itself, the composer, text entry, editors, modals and plain elements apart", () => {
		expect(kind(null)).toBe("none");
		expect(kind(body)).toBe("none");
		expect(kind(node("BUTTON"), { inside: true })).toBe("inside");
		expect(kind(composer(""), { keyboard: true })).toBe("empty-composer");
		expect(kind(composer("draft"), { keyboard: true })).toBe("editing");
		expect(
			kind(node("TEXTAREA", { attributes: { "data-testid": "review-composer" }, value: "" })),
		).toBe("editing");
		expect(kind(node("INPUT"))).toBe("editing");
		expect(kind(node("IFRAME"))).toBe("editing");
		expect(kind(node("DIV", { editable: true }))).toBe("editing");
		expect(kind(node("TEXTAREA", { within: [".monaco-editor"] }))).toBe("editing");
		expect(kind(node("DIV", { within: [".xterm"] }))).toBe("editing");
		expect(kind(node("BUTTON", { within: ['[role="dialog"]'] }))).toBe("modal");
		expect(kind(node("DIV", { within: ['[role="menu"]'] }))).toBe("modal");
		expect(kind(node("DIV", { within: ['[role="listbox"]'] }))).toBe("modal");
		expect(kind(node("BUTTON", { within: ['[role="alertdialog"]'] }))).toBe("modal");
		expect(kind(node("BUTTON"))).toBe("pointer");
		expect(kind(node("BUTTON"), { keyboard: true })).toBe("keyboard");
	});

	it("claims from <body>, an empty composer or a control the mouse focused, only while the chat allows it", () => {
		expect(claims(null)).toBe(true);
		expect(claims(body)).toBe(true);
		expect(claims(composer(""), true)).toBe(true);
		expect(claims(node("BUTTON", { attributes: { "data-testid": "chat-history" } }))).toBe(true);
		expect(claims(node("ARTICLE", { attributes: { "data-transcript-item": "u1" } }))).toBe(true);
		expect(shouldClaimQuestionFocus("none", false, false)).toBe(false);
		expect(shouldClaimQuestionFocus("empty-composer", false, false)).toBe(false);
		expect(shouldClaimQuestionFocus("pointer", false, false)).toBe(false);
	});

	it("never claims from keyboard navigation, a draft, other text entry, an editor or a modal surface", () => {
		expect(claims(node("BUTTON"), true)).toBe(false);
		expect(claims(node("ARTICLE", { attributes: { "data-transcript-item": "u1" } }), true)).toBe(
			false,
		);
		expect(claims(node("DIV", { attributes: { role: "treeitem" } }), true)).toBe(false);
		expect(claims(node("BUTTON", { attributes: { role: "tab" } }), true)).toBe(false);
		expect(claims(composer("draft"), true)).toBe(false);
		expect(claims(node("INPUT"))).toBe(false);
		expect(claims(node("TEXTAREA", { within: [".monaco-editor"] }))).toBe(false);
		expect(claims(node("DIV", { within: [".xterm"] }))).toBe(false);
		expect(claims(node("BUTTON", { within: ['[role="dialog"]'] }))).toBe(false);
		expect(claims(node("DIV", { within: ['[role="menu"]'] }))).toBe(false);
		expect(shouldClaimQuestionFocus("inside", false, true)).toBe(false);
	});

	it("never moves focus on a coarse pointer, whatever holds it (no soft keyboard on reveal)", () => {
		expect(shouldClaimQuestionFocus("none", true, true)).toBe(false);
		expect(shouldClaimQuestionFocus("empty-composer", true, true)).toBe(false);
		expect(shouldClaimQuestionFocus("pointer", true, true)).toBe(false);
	});

	it("claims attention once per tool call and mounted-chat scope", () => {
		const claim = createQuestionAttentionClaim();
		const firstMount = {};
		const reopenedMount = {};
		expect(claim(firstMount, "ask-1")).toBe(true);
		expect(claim(firstMount, "ask-1")).toBe(false);
		expect(claim(firstMount, "ask-2")).toBe(true);
		expect(claim(reopenedMount, "ask-1")).toBe(true);
	});

	it("lets a page change take focus everywhere except into a text field on touch", () => {
		expect(shouldFocusPageTarget(false, true)).toBe(true);
		expect(shouldFocusPageTarget(true, true)).toBe(false);
		expect(shouldFocusPageTarget(true, false)).toBe(true);
		expect(shouldFocusPageTarget(false, false)).toBe(true);
	});
});

describe("how far the card's scroller moves to reveal the focused row", () => {
	const view = { top: 100, bottom: 400 };

	it("leaves a row that is already fully visible where it is", () => {
		expect(revealDelta(view, { top: 100, bottom: 400 })).toBe(0);
		expect(revealDelta(view, { top: 150, bottom: 200 })).toBe(0);
	});

	it("scrolls just enough to bring a row below or above fully into view", () => {
		expect(revealDelta(view, { top: 380, bottom: 440 })).toBe(40);
		expect(revealDelta(view, { top: 900, bottom: 960 })).toBe(560);
		expect(revealDelta(view, { top: 80, bottom: 140 })).toBe(-20);
		expect(revealDelta(view, { top: -500, bottom: -440 })).toBe(-600);
	});

	it("shows the top of a row taller than the scroller", () => {
		expect(revealDelta(view, { top: 300, bottom: 800 })).toBe(200);
		expect(revealDelta(view, { top: 50, bottom: 550 })).toBe(-50);
	});
});

describe("whether the keyboard put focus where it is", () => {
	const page = new EventTarget();
	watchInputModality(page);
	const press = (key: string) => page.dispatchEvent(Object.assign(new Event("keydown"), { key }));
	const pointer = () => page.dispatchEvent(new Event("pointerdown"));
	const focus = (element: object) =>
		page.dispatchEvent(Object.defineProperty(new Event("focusin"), "target", { value: element }));
	const claimsFrom = (element: FocusedNode) => claims(element, isKeyboardFocused(element));

	it("keeps a control the mouse focused the mouse's through bare modifiers, so the card still claims it", () => {
		const history = node("BUTTON", { attributes: { "data-testid": "chat-history" } });
		pointer();
		focus(history);
		for (const modifier of ["Shift", "Control", "Alt", "Meta", "CapsLock", "AltGraph"]) {
			press(modifier);
			expect(isKeyboardFocused(history)).toBe(false);
		}
		expect(claimsFrom(history)).toBe(true);
	});

	it("keeps it the mouse's through a key that moves no focus", () => {
		const tab = node("BUTTON", { attributes: { role: "tab" } });
		pointer();
		focus(tab);
		press("x");
		press("Enter");
		expect(isKeyboardFocused(tab)).toBe(false);
		expect(claimsFrom(tab)).toBe(true);
	});

	it("gives focus that a key moved to the keyboard: a Tab or arrow walk, or Mod+↑ from a clicked composer", () => {
		const clicked = composer("");
		const tabbed = node("BUTTON");
		const walked = node("DIV", { attributes: { role: "treeitem" } });
		const row = node("ARTICLE", { attributes: { "data-transcript-item": "u1" } });
		pointer();
		focus(clicked);
		press("Tab");
		focus(tabbed);
		expect(claimsFrom(tabbed)).toBe(false);
		press("ArrowDown");
		focus(walked);
		expect(claimsFrom(walked)).toBe(false);
		expect(isKeyboardFocused(tabbed)).toBe(false);

		pointer();
		focus(clicked);
		press("Control");
		press("ArrowUp");
		focus(row);
		expect(claimsFrom(row)).toBe(false);
	});

	it("hands focus back to the mouse on a pointer press, before or after the key", () => {
		const button = node("BUTTON");
		const other = node("BUTTON");
		pointer();
		press("Tab");
		focus(button);
		expect(isKeyboardFocused(button)).toBe(true);
		pointer();
		expect(isKeyboardFocused(button)).toBe(false);
		expect(claimsFrom(button)).toBe(true);

		press("Tab");
		pointer();
		focus(other);
		expect(claimsFrom(other)).toBe(true);
		expect(isKeyboardFocused(null)).toBe(false);
	});
});
