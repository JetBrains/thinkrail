import { expect, test } from "bun:test";
import type { GitFileChange } from "@thinkrail/contracts";
import {
	buildChangesTree,
	type ChangeTreeDir,
	diffTabId,
	diffTabName,
	isDiffTabId,
	scopeKey,
	scopeLabel,
	scopeTitle,
	splitPath,
} from "./changesModel";

function change(path: string, over: Partial<GitFileChange> = {}): GitFileChange {
	return { path, status: "modified", added: 1, removed: 0, ...over };
}

test("buildChangesTree nests files under their folders", () => {
	const tree = buildChangesTree([
		change("apps/web/a.ts"),
		change("apps/web/b.ts"),
		change("packages/server/c.ts"),
	]);
	expect(tree.map((n) => n.name)).toEqual(["apps", "packages"]);
	const apps = tree[0] as ChangeTreeDir;
	const web = apps.children[0] as ChangeTreeDir;
	expect(web.name).toBe("web");
	expect(web.children.map((n) => n.name)).toEqual(["a.ts", "b.ts"]);
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
	// A pinned scope (the review sidebar's base-side navigation) keys off its own immutable baseRef, so a
	// pinned diff tab is distinct from a same-file branch/commit one.
	expect(scopeKey({ kind: "pinned", baseRef: "abc123" })).toBe("pinned:abc123");

	// One file, two scopes → two ids (a tab's content must never change meaning under it).
	const branch = diffTabId("ws1", { kind: "branch" }, "src/a.ts");
	const commit = diffTabId("ws1", { kind: "commit", sha: "abc123" }, "src/a.ts");
	expect(branch).toBe("ws1:diff:branch:src/a.ts");
	expect(commit).not.toBe(branch);
	// Both stay recognizable as diff tabs of that workspace (the prefix rule), and not of another.
	expect(isDiffTabId("ws1", branch)).toBe(true);
	expect(isDiffTabId("ws1", commit)).toBe(true);
	expect(isDiffTabId("ws2", commit)).toBe(false);
});

test("diffTabName tags every non-default scope so two tabs of one file are distinguishable", () => {
	expect(diffTabName({ kind: "branch" }, "src/a.ts")).toBe("a.ts");
	expect(diffTabName({ kind: "uncommitted" }, "src/a.ts")).toBe("a.ts · uncommitted");
	expect(diffTabName({ kind: "commit", sha: "abc1234567" }, "src/a.ts")).toBe("a.ts · abc1234");
	// A pinned tab tags with its baseRef's short oid, same form as a commit tab.
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
	// The pill never carries a commit *subject* — a sentence there squeezes the sibling target-branch pill.
	expect(scopeLabel({ kind: "commit", sha: "abc1234567" }, commits)).toBe("abc1234");
	expect(scopeLabel({ kind: "commit", sha: "abc1234567" })).toBe("abc1234");
	// The subject lives in the tooltip (and the menu row), where there is room for it.
	expect(scopeTitle({ kind: "commit", sha: "abc1234567" }, commits)).toBe(
		"abc1234 · Fix the thing",
	);
	expect(scopeTitle({ kind: "commit", sha: "abc1234567" })).toBe("abc1234");
	expect(scopeTitle({ kind: "uncommitted" })).toBe("Diff scope: Uncommitted");
	// A pinned scope reads as its short baseRef in both the pill and the tooltip.
	expect(scopeLabel({ kind: "pinned", baseRef: "abc1234567" })).toBe("abc1234");
	expect(scopeTitle({ kind: "pinned", baseRef: "abc1234567" })).toBe("Diff scope: abc1234");
});

test("splitPath separates the muted directory prefix from the bright basename", () => {
	expect(splitPath("apps/web/src/a.ts")).toEqual({ dir: "apps/web/src/", base: "a.ts" });
	expect(splitPath("README.md")).toEqual({ dir: "", base: "README.md" });
});
