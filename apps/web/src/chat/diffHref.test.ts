import { expect, test } from "bun:test";
import { buildDiffHref, parseDiffHref } from "./diffHref";

test("round-trips a commit-scope link (sha + path)", () => {
	const href = buildDiffHref("abc123", "src/foo.ts");
	expect(href).toBe("thinkrail-diff:abc123:src%2Ffoo.ts");
	expect(parseDiffHref(href)).toEqual({ sha: "abc123", path: "src/foo.ts" });
});

test("round-trips a branch-scope link (null sha)", () => {
	const href = buildDiffHref(null, "src/bar.ts");
	expect(href).toBe("thinkrail-diff::src%2Fbar.ts");
	expect(parseDiffHref(href)).toEqual({ sha: null, path: "src/bar.ts" });
});

test("encodes special characters in the path so they survive the delimiter + markdown", () => {
	const href = buildDiffHref("sha", "a b/c:d.ts");
	expect(parseDiffHref(href)).toEqual({ sha: "sha", path: "a b/c:d.ts" });
});

test("rejects non-tr-diff and malformed hrefs", () => {
	expect(parseDiffHref(undefined)).toBeNull();
	expect(parseDiffHref("https://example.com")).toBeNull();
	expect(parseDiffHref("./relative.ts")).toBeNull();
	expect(parseDiffHref("thinkrail-diff:no-delimiter")).toBeNull();
	expect(parseDiffHref("thinkrail-diff:sha:")).toBeNull(); // empty path
});
