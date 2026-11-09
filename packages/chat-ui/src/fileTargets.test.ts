import { describe, expect, it } from "bun:test";
import { mentionLookup, workspaceFileTarget } from "./fileTargets";

describe("mentionLookup", () => {
	it("splits a typed @-path into the folder to list and the name prefix, either separator", () => {
		expect(mentionLookup("src\\Comp")).toEqual({ dir: "src", prefix: "comp" });
		expect(mentionLookup("src/components/")).toEqual({ dir: "src/components", prefix: "" });
		expect(mentionLookup(".\\docs\\RE")).toEqual({ dir: "docs", prefix: "re" });
		expect(mentionLookup("READ")).toEqual({ dir: "", prefix: "read" });
	});
});

describe("workspaceFileTarget", () => {
	it("canonicalizes only paths contained by the active worktree", () => {
		for (const [path, root, expected] of [
			["module-a/../README.md", "/repo", "README.md"],
			["/repo/module-a/SPEC.md", "/repo", "module-a/SPEC.md"],
			["C:\\repo\\module-a\\SPEC.md", "C:\\repo", "module-a/SPEC.md"],
			["/repo-other/SPEC.md", "/repo", null],
			["../outside.md", "/repo", null],
			["https://example.com/a.md", "/repo", null],
			["file:///repo/a.md", "/repo", null],
			["", "/repo", null],
		] as const) {
			expect(workspaceFileTarget(path, root)).toBe(expected);
		}
	});
});
