import { describe, it, expect } from "vitest";
import { wordDiff } from "@/utils/wordDiff.ts";

describe("wordDiff", () => {
  it("returns empty for two empty strings", () => {
    expect(wordDiff("", "")).toEqual([]);
  });

  it("returns equal segment for identical strings", () => {
    expect(wordDiff("hello world", "hello world")).toEqual([
      { kind: "equal", text: "hello world" },
    ]);
  });

  it("marks added word", () => {
    expect(wordDiff("hello world", "hello brave world")).toEqual([
      { kind: "equal", text: "hello " },
      { kind: "added", text: "brave " },
      { kind: "equal", text: "world" },
    ]);
  });

  it("marks removed word", () => {
    expect(wordDiff("hello brave world", "hello world")).toEqual([
      { kind: "equal", text: "hello " },
      { kind: "removed", text: "brave " },
      { kind: "equal", text: "world" },
    ]);
  });

  it("handles full replacement", () => {
    expect(wordDiff("foo", "bar")).toEqual([
      { kind: "removed", text: "foo" },
      { kind: "added", text: "bar" },
    ]);
  });

  it("preserves whitespace when concatenated back to original", () => {
    const segs = wordDiff("the quick brown fox", "the lazy brown dog");
    const oldRebuilt = segs
      .filter((s) => s.kind !== "added")
      .map((s) => s.text)
      .join("");
    const newRebuilt = segs
      .filter((s) => s.kind !== "removed")
      .map((s) => s.text)
      .join("");
    expect(oldRebuilt).toBe("the quick brown fox");
    expect(newRebuilt).toBe("the lazy brown dog");
  });
});
