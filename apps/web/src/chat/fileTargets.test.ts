import { describe, expect, it } from "bun:test";
import { workspaceFileTarget } from "./fileTargets";

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
