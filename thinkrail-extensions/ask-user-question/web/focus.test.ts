import { describe, expect, it } from "bun:test";
import {
	createQuestionAttentionClaim,
	type FocusedNode,
	focusTargetKind,
	shouldClaimQuestionFocus,
	shouldFocusPageTarget,
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
const kind = (active: FocusedNode | null, inside = false) => focusTargetKind(active, inside);
const claims = (active: FocusedNode | null) => shouldClaimQuestionFocus(kind(active), false, true);

describe("where a question's focus claim may land", () => {
	it("tells <body>, the card itself, the composer, text entry, editors, modals and plain elements apart", () => {
		expect(kind(null)).toBe("none");
		expect(kind(body)).toBe("none");
		expect(kind(node("BUTTON"), true)).toBe("inside");
		expect(kind(composer(""))).toBe("empty-composer");
		expect(kind(composer("draft"))).toBe("editing");
		expect(
			kind(node("TEXTAREA", { attributes: { "data-testid": "review-composer" }, value: "" })),
		).toBe("editing");
		expect(kind(node("INPUT"))).toBe("editing");
		expect(kind(node("SELECT"))).toBe("editing");
		expect(kind(node("IFRAME"))).toBe("editing");
		expect(kind(node("DIV", { editable: true }))).toBe("editing");
		expect(kind(node("TEXTAREA", { within: [".monaco-editor"] }))).toBe("editing");
		expect(kind(node("DIV", { within: [".xterm"] }))).toBe("editing");
		expect(kind(node("BUTTON", { within: ['[role="dialog"]'] }))).toBe("modal");
		expect(kind(node("DIV", { within: ['[role="menu"]'] }))).toBe("modal");
		expect(kind(node("DIV", { within: ['[role="listbox"]'] }))).toBe("modal");
		expect(kind(node("BUTTON", { within: ['[role="alertdialog"]'] }))).toBe("modal");
		expect(kind(node("BUTTON"))).toBe("element");
	});

	it("claims from <body>, an empty composer and any non-text element, however it got focus", () => {
		expect(claims(null)).toBe(true);
		expect(claims(body)).toBe(true);
		expect(claims(composer(""))).toBe(true);
		expect(claims(node("BUTTON", { attributes: { "data-testid": "chat-history" } }))).toBe(true);
		expect(claims(node("ARTICLE", { attributes: { "data-transcript-item": "u1" } }))).toBe(true);
		expect(claims(node("DIV", { attributes: { role: "feed", "data-focus-park": "" } }))).toBe(true);
		expect(claims(node("DIV", { attributes: { role: "treeitem" } }))).toBe(true);
		expect(claims(node("BUTTON", { attributes: { role: "tab" } }))).toBe(true);
		expect(claims(node("SECTION", { attributes: { "data-region": "left" } }))).toBe(true);
	});

	it("never claims while the user types: a draft, other text entry, an editor or a modal surface", () => {
		expect(claims(composer("draft"))).toBe(false);
		expect(claims(node("INPUT"))).toBe(false);
		expect(claims(node("TEXTAREA"))).toBe(false);
		expect(claims(node("SELECT"))).toBe(false);
		expect(claims(node("IFRAME"))).toBe(false);
		expect(claims(node("DIV", { editable: true }))).toBe(false);
		expect(claims(node("TEXTAREA", { within: [".monaco-editor"] }))).toBe(false);
		expect(claims(node("DIV", { within: [".xterm"] }))).toBe(false);
		expect(claims(node("BUTTON", { within: ['[role="dialog"]'] }))).toBe(false);
		expect(claims(node("BUTTON", { within: ['[role="alertdialog"]'] }))).toBe(false);
		expect(claims(node("DIV", { within: ['[role="menu"]'] }))).toBe(false);
		expect(claims(node("DIV", { within: ['[role="listbox"]'] }))).toBe(false);
		expect(shouldClaimQuestionFocus("inside", false, true)).toBe(false);
	});

	it("never claims where the chat withholds it", () => {
		expect(shouldClaimQuestionFocus("none", false, false)).toBe(false);
		expect(shouldClaimQuestionFocus("empty-composer", false, false)).toBe(false);
		expect(shouldClaimQuestionFocus("element", false, false)).toBe(false);
	});

	it("never moves focus on a coarse pointer, whatever holds it (no soft keyboard on reveal)", () => {
		expect(shouldClaimQuestionFocus("none", true, true)).toBe(false);
		expect(shouldClaimQuestionFocus("empty-composer", true, true)).toBe(false);
		expect(shouldClaimQuestionFocus("element", true, true)).toBe(false);
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
