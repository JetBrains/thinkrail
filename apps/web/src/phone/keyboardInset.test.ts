import { expect, test } from "bun:test";
import { followsKeyboard, keyboardHeightOf } from "./keyboardInset";

const withHeight = (keyboardHeight: unknown): Event =>
	Object.assign(new Event("keyboardWillShow"), { keyboardHeight });

test("the keyboard's height is read off the plugin's event, and anything else reads as closed", () => {
	expect(keyboardHeightOf(withHeight(336.4))).toBe(336);
	expect(keyboardHeightOf(withHeight(0))).toBe(0);
	expect(keyboardHeightOf(withHeight(-5))).toBe(0);
	expect(keyboardHeightOf(withHeight("336"))).toBe(0);
	expect(keyboardHeightOf(new Event("keyboardWillShow"))).toBe(0);
});

test("only Android, which resizes the web view for the keyboard itself, leaves the inset alone", () => {
	expect(followsKeyboard("ios")).toBe(true);
	expect(followsKeyboard("web")).toBe(true);
	expect(followsKeyboard("android")).toBe(false);
});
