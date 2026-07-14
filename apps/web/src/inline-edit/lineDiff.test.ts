import { expect, test } from "bun:test";
import { changedLineRange } from "./lineDiff";

test("identical text returns null", () => {
	expect(changedLineRange("a\nb\nc", "a\nb\nc")).toBeNull();
});

test("a single changed middle line yields the 1-based range for that line", () => {
	expect(changedLineRange("a\nb\nc", "a\nX\nc")).toEqual({ start: 2, end: 2 });
});

test("a pure insertion yields the range covering the inserted line(s)", () => {
	expect(changedLineRange("a\nc", "a\nb\nc")).toEqual({ start: 2, end: 2 });
});

test("a change at the last line yields a range ending at the last line", () => {
	expect(changedLineRange("a\nb\nc", "a\nb\nZ")).toEqual({ start: 3, end: 3 });
});

test("a multi-line insertion in the middle yields the full inserted span", () => {
	expect(changedLineRange("a\nd", "a\nb\nc\nd")).toEqual({ start: 2, end: 3 });
});
