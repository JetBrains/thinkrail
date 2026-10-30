import { describe, expect, test } from "bun:test";
import type { Workspace } from "@thinkrail/contracts";
import { paletteSearchContext } from "./useSearchPalette";

const row = (id: string, kind?: Workspace["kind"]): Workspace => ({
	id,
	projectId: "p1",
	name: id,
	branch: id,
	baseBranch: "main",
	worktreePath: `/w/${id}`,
	...(kind ? { kind } : {}),
});

describe("paletteSearchContext", () => {
	test("names the active workspace, else the context project's Default once its row is loaded", () => {
		const workspaces = { p1: [row("feature"), row("default", "default")] };
		expect(paletteSearchContext("p1", "feature", workspaces)).toEqual({
			projectId: "p1",
			workspaceId: "feature",
		});
		expect(paletteSearchContext("p1", null, workspaces)).toEqual({
			projectId: "p1",
			workspaceId: "default",
		});
		expect(paletteSearchContext("p1", null, {})).toEqual({ projectId: "p1" });
		expect(paletteSearchContext(null, null, workspaces)).toEqual({});
	});
});
