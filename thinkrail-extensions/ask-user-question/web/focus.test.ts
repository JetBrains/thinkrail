import { describe, expect, it } from "bun:test";
import {
	createQuestionAttentionClaim,
	type FocusedNode,
	focusTargetKind,
	shouldClaimQuestionFocus,
	shouldFocusPageTarget,
} from "./focus";

const page: { body: unknown; documentElement: unknown } = { body: null, documentElement: null };
const node = (tagName: string, attributes: Record<string, string> = {}, value?: string) => ({
	ownerDocument: page,
	tagName,
	value,
	getAttribute: (name: string) => attributes[name] ?? null,
});
const body = node("BODY");
page.body = body;
const kind = (active: FocusedNode | null, inside = false) => focusTargetKind(active, inside);

describe("where a question's focus claim may land", () => {
	it("tells <body>, the card itself, an empty composer and everything else apart", () => {
		expect(kind(null)).toBe("none");
		expect(kind(body)).toBe("none");
		expect(kind(node("BUTTON"), true)).toBe("inside");
		expect(kind(node("TEXTAREA", { "data-testid": "chat-input" }, ""))).toBe("empty-composer");
		expect(kind(node("TEXTAREA", { "data-testid": "chat-input" }, "draft"))).toBe("occupied");
		expect(kind(node("ARTICLE", { "data-transcript-item": "u1" }))).toBe("occupied");
		expect(kind(node("DIV", { role: "treeitem" }))).toBe("occupied");
		expect(kind(node("BUTTON", { role: "tab" }))).toBe("occupied");
		expect(kind(node("TEXTAREA", { "data-testid": "review-composer" }, ""))).toBe("occupied");
	});

	it("claims only from <body> or an empty composer, and only while the chat allows it", () => {
		expect(shouldClaimQuestionFocus("none", false, true)).toBe(true);
		expect(shouldClaimQuestionFocus("empty-composer", false, true)).toBe(true);
		expect(shouldClaimQuestionFocus("occupied", false, true)).toBe(false);
		expect(shouldClaimQuestionFocus("inside", false, true)).toBe(false);
		expect(shouldClaimQuestionFocus("none", false, false)).toBe(false);
		expect(shouldClaimQuestionFocus("empty-composer", false, false)).toBe(false);
	});

	it("never moves focus on a coarse pointer, whatever holds it (no soft keyboard on reveal)", () => {
		expect(shouldClaimQuestionFocus("none", true, true)).toBe(false);
		expect(shouldClaimQuestionFocus("empty-composer", true, true)).toBe(false);
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
