import { expect, test } from "bun:test";
import { projectRelativePath } from "./utils";

test("projectRelativePath keeps already-relative paths", () => {
	expect(projectRelativePath("apps/web/src/App.tsx", "/repo")).toBe("apps/web/src/App.tsx");
	expect(projectRelativePath("./apps/web/src/App.tsx", "/repo")).toBe("apps/web/src/App.tsx");
	expect(projectRelativePath("")).toBe("");
});

test("projectRelativePath strips a matching workspace root from absolute paths", () => {
	expect(projectRelativePath("/repo/apps/web/src/App.tsx", "/repo")).toBe("apps/web/src/App.tsx");
	expect(projectRelativePath("/repo/apps/web/src/App.tsx", "/repo/")).toBe("apps/web/src/App.tsx");
	expect(projectRelativePath("C:\\repo\\apps\\web\\src\\App.tsx", "C:\\repo")).toBe(
		"apps/web/src/App.tsx",
	);
});

test("projectRelativePath leaves unmatched absolute paths intact", () => {
	expect(projectRelativePath("/other/App.tsx", "/repo")).toBe("/other/App.tsx");
});
