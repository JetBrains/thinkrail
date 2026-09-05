import { expect, test } from "bun:test";
import type { BranchList } from "@thinkrail/contracts";
import { remoteBranchPresentation } from "./branchGroups";

test("host-supplied remote groups drive the two-layer presentation", () => {
	const branches = {
		local: ["main"],
		remote: ["origin/main", "upstream/main"],
		remoteGroups: [
			{ remote: "origin", branches: [{ ref: "origin/main", branch: "main" }] },
			{ remote: "upstream", branches: [{ ref: "upstream/main", branch: "main" }] },
		],
		defaultBranch: "origin/main",
	} satisfies BranchList;

	expect(remoteBranchPresentation(branches)).toEqual({
		kind: "grouped",
		groups: branches.remoteGroups,
	});
});

test("an older host without grouping metadata keeps full refs in one layer", () => {
	const branches = {
		local: ["main"],
		remote: ["origin/main", "team/upstream/main"],
		defaultBranch: "origin/main",
	} satisfies BranchList;

	expect(remoteBranchPresentation(branches)).toEqual({
		kind: "flat",
		refs: ["origin/main", "team/upstream/main"],
	});
});
