import { expect, test } from "bun:test";
import { canonicalWorkspacePath } from "@thinkrail/resource-renderers";
import { projectRelativePath } from "../lib";

const WORKSPACE_RELATIVE = [
	"a.html",
	"./a.html",
	".//a.html",
	"././a.html",
	"dir//a.html",
	"dir/./a.html",
	"dir/../a.html",
	"a/b/../../c.md",
	"dir\\sub\\a.html",
	".\\dir\\a.html",
	"..draft.html",
	".thinkrail/context/mockups/after.html",
];

test("a file preview and an opened tab name a workspace-relative file the same way", () => {
	for (const path of WORKSPACE_RELATIVE) {
		expect(canonicalWorkspacePath(path)).toBe(projectRelativePath(path));
	}
});
