import { expect, test } from "bun:test";
import type { BranchList } from "@thinkrail/contracts";
import { hasRemoteBranches, remoteBranchPresentation } from "./branchGroups";

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

test("a repo with no remote branches reads as local-only", () => {
	const local = { local: ["main"], remote: [], remoteGroups: [], defaultBranch: "main" };
	expect(hasRemoteBranches(remoteBranchPresentation(local))).toBe(false);
	expect(hasRemoteBranches(remoteBranchPresentation({ ...local, remoteGroups: undefined }))).toBe(
		false,
	);
	expect(
		hasRemoteBranches(
			remoteBranchPresentation({
				...local,
				remote: ["origin/main"],
				remoteGroups: [{ remote: "origin", branches: [{ ref: "origin/main", branch: "main" }] }],
			}),
		),
	).toBe(true);
});
