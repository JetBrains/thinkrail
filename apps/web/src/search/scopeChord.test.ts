import { expect, test } from "bun:test";
import { scopeChordIndex } from "./scopeChord";

const chord = (key: string, modifiers: { ctrlKey?: boolean; metaKey?: boolean } = {}) => ({
	key,
	altKey: true,
	ctrlKey: modifiers.ctrlKey ?? false,
	metaKey: modifiers.metaKey ?? false,
});

test("plain Alt+digit picks a scope on Windows and Linux", () => {
	expect(scopeChordIndex(chord("1"), "Win32")).toBe(0);
	expect(scopeChordIndex(chord("3"), "Linux x86_64")).toBe(2);
	expect(scopeChordIndex({ ...chord("3"), altKey: false }, "Win32")).toBeNull();
});

test("a character typed with Alt or AltGr on a digit key stays the input's", () => {
	expect(scopeChordIndex(chord("#", { ctrlKey: true }), "Win32")).toBeNull();
	expect(scopeChordIndex(chord("3", { ctrlKey: true }), "Win32")).toBeNull();
	expect(scopeChordIndex(chord("@"), "Linux x86_64")).toBeNull();
	expect(scopeChordIndex(chord("0"), "Win32")).toBeNull();
});

test("macOS has no digit chord: Option+digit always types its character", () => {
	expect(scopeChordIndex(chord("#"), "MacIntel")).toBeNull();
	expect(scopeChordIndex(chord("3"), "MacIntel")).toBeNull();
	expect(scopeChordIndex(chord("3", { metaKey: true }), "MacIntel")).toBeNull();
});
