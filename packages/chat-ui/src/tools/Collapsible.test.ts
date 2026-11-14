import { expect, test } from "bun:test";
import { countLines } from "./Collapsible";

test("countLines: empty string is 0 lines", () => {
	expect(countLines("")).toBe(0);
});

test("countLines: a single line with no newline", () => {
	expect(countLines("hello")).toBe(1);
});

test("countLines: interior newlines count as separate lines", () => {
	expect(countLines("a\nb\nc")).toBe(3);
});

test("countLines: a single trailing newline does not add a phantom line", () => {
	expect(countLines("a\nb\n")).toBe(2);
	expect(countLines("a\n")).toBe(1);
});

test("countLines: a blank line between content still counts", () => {
	expect(countLines("a\n\nb")).toBe(3);
});
