import { expect, test } from "bun:test";
import { canonicalWorkspacePath } from "./paths";

test("workspace paths drop dot and empty segments and resolve inner parents", () => {
	expect(canonicalWorkspacePath("./.thinkrail/context/mockups/after.html")).toBe(
		".thinkrail/context/mockups/after.html",
	);
	expect(canonicalWorkspacePath("mockups/old/../after.html")).toBe("mockups/after.html");
	expect(canonicalWorkspacePath("a//b\\c.md")).toBe("a/b/c.md");
	expect(canonicalWorkspacePath("../outside.html")).toBe("../outside.html");
});
