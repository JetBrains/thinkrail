import { expect, test } from "bun:test";
import type { GitFileChange } from "@thinkrail/contracts";
import {
	buildChangesTree,
	type ChangeTreeDir,
	diffTabId,
	diffTabName,
	scopeKey,
	scopeLabel,
	scopeTitle,
	splitPath,
} from "./changesModel";

function change(path: string, over: Partial<GitFileChange> = {}): GitFileChange {
	return { path, status: "modified", added: 1, removed: 0, ...over };
}

test("buildChangesTree compacts single-directory runs and stops before files", () => {
	const tree = buildChangesTree([
		change("apps/web/a.ts"),
		change("apps/web/b.ts"),
		change("packages/server/c.ts"),
	]);
	expect(tree.map((n) => n.name)).toEqual(["apps/web", "packages/server"]);
	const appsWeb = tree[0] as ChangeTreeDir;
	expect(appsWeb.path).toBe("apps/web");
	expect(appsWeb.children.map((n) => n.name)).toEqual(["a.ts", "b.ts"]);
	const packagesServer = tree[1] as ChangeTreeDir;
	expect(packagesServer.children.map((n) => n.name)).toEqual(["c.ts"]);
});

test("buildChangesTree stops compaction at a branching directory", () => {
	const tree = buildChangesTree([change("src/client/a.ts"), change("src/server/b.ts")]);
	const src = tree[0] as ChangeTreeDir;
	expect(src.name).toBe("src");
	expect(src.children.map((n) => n.name)).toEqual(["client", "server"]);
});

test("buildChangesTree aggregates +/- counts up into folders", () => {
	const tree = buildChangesTree([
		change("src/x.ts", { added: 3, removed: 1 }),
		change("src/deep/y.ts", { added: 5, removed: 2 }),
	]);
	const src = tree[0] as ChangeTreeDir;
	expect(src.added).toBe(8);
	expect(src.removed).toBe(3);
	const deep = src.children.find((n) => n.name === "deep") as ChangeTreeDir;
	expect(deep.added).toBe(5);
	expect(deep.removed).toBe(2);
});

test("buildChangesTree sorts directories before files, each alphabetically", () => {
	const tree = buildChangesTree([change("z.ts"), change("a.ts"), change("dir/inner.ts")]);
	expect(tree.map((n) => `${n.kind}:${n.name}`)).toEqual(["dir:dir", "file:a.ts", "file:z.ts"]);
});

test("buildChangesTree treats missing counts as zero", () => {
	const tree = buildChangesTree([{ path: "bin.png", status: "modified" }]);
	expect(tree[0]).toMatchObject({ kind: "file", name: "bin.png", added: 0, removed: 0 });
});

test("scopeKey + diffTabId: the scope is part of a diff tab's identity", () => {
	expect(scopeKey({ kind: "branch" })).toBe("branch");
	expect(scopeKey({ kind: "uncommitted" })).toBe("uncommitted");
	expect(scopeKey({ kind: "commit", sha: "abc123" })).toBe("commit:abc123");
	expect(scopeKey({ kind: "pinned", baseRef: "abc123" })).toBe("pinned:abc123");

	const branch = diffTabId("ws1", { kind: "branch" }, "src/a.ts");
	const commit = diffTabId("ws1", { kind: "commit", sha: "abc123" }, "src/a.ts");
	expect(branch).toBe("diff:3:ws16:branch8:src/a.ts");
	expect(commit).not.toBe(branch);
});

test("diffTabName tags every non-default scope so two tabs of one file are distinguishable", () => {
	expect(diffTabName({ kind: "branch" }, "src/a.ts")).toBe("a.ts");
	expect(diffTabName({ kind: "uncommitted" }, "src/a.ts")).toBe("a.ts · uncommitted");
	expect(diffTabName({ kind: "commit", sha: "abc1234567" }, "src/a.ts")).toBe("a.ts · abc1234");
	expect(diffTabName({ kind: "pinned", baseRef: "abc1234567" }, "src/a.ts")).toBe("a.ts · abc1234");
});

test("scopeLabel keeps a commit scope short (sha), with the subject in the tooltip", () => {
	const commits = [
		{
			sha: "abc1234567",
			shortSha: "abc1234",
			subject: "Fix the thing",
			author: "dev",
			committedAt: "",
		},
	];
	expect(scopeLabel({ kind: "branch" })).toBe("All changes");
	expect(scopeLabel({ kind: "uncommitted" })).toBe("Uncommitted");
	expect(scopeLabel({ kind: "commit", sha: "abc1234567" }, commits)).toBe("abc1234");
	expect(scopeLabel({ kind: "commit", sha: "abc1234567" })).toBe("abc1234");
	expect(scopeTitle({ kind: "commit", sha: "abc1234567" }, commits)).toBe(
		"abc1234 · Fix the thing",
	);
	expect(scopeTitle({ kind: "commit", sha: "abc1234567" })).toBe("abc1234");
	expect(scopeTitle({ kind: "uncommitted" })).toBe("Diff scope: Uncommitted");
	expect(scopeLabel({ kind: "pinned", baseRef: "abc1234567" })).toBe("abc1234");
	expect(scopeTitle({ kind: "pinned", baseRef: "abc1234567" })).toBe("Diff scope: abc1234");
});

test("splitPath separates the muted directory prefix from the bright basename", () => {
	expect(splitPath("apps/web/src/a.ts")).toEqual({ dir: "apps/web/src/", base: "a.ts" });
	expect(splitPath("README.md")).toEqual({ dir: "", base: "README.md" });
});
