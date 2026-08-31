import { expect, test } from "bun:test";
import { groupBranchesByRemote } from "./branchGroups";

test("each remote becomes its own group, holding branch names without the prefix", () => {
	expect(groupBranchesByRemote(["origin/main", "origin/feature/tabs", "upstream/main"])).toEqual([
		{
			remote: "origin",
			branches: [
				{ ref: "origin/main", name: "main" },
				{ ref: "origin/feature/tabs", name: "feature/tabs" },
			],
		},
		{ remote: "upstream", branches: [{ ref: "upstream/main", name: "main" }] },
	]);
});

test("groups appear in the order their remote first does, and keep the given branch order", () => {
	expect(
		groupBranchesByRemote(["upstream/main", "origin/main", "upstream/next"]).map((g) => [
			g.remote,
			...g.branches.map((b) => b.name),
		]),
	).toEqual([
		["upstream", "main", "next"],
		["origin", "main"],
	]);
});

test("a ref with no remote prefix still lists, under the generic heading", () => {
	expect(groupBranchesByRemote(["detached"])).toEqual([
		{ remote: "Remote", branches: [{ ref: "detached", name: "detached" }] },
	]);
});

test("no remote branches is no groups — the picker renders nothing rather than an empty heading", () => {
	expect(groupBranchesByRemote([])).toEqual([]);
});
