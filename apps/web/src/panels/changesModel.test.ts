import { expect, test } from "bun:test";
import type { GitFileChange } from "@thinkrail/contracts";
import {
	buildChangesTree,
	type ChangeTreeDir,
	changesReadKey,
	comparisonTargetLabel,
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

test("scopeLabel names the two uncommitted halves distinctly", () => {
	expect(scopeLabel({ kind: "working-tree" })).toBe("Working tree");
	expect(scopeLabel({ kind: "staged" })).toBe("Staged");
});

test("a file open in working-tree and staged scope is two distinct tabs", () => {
	const working = diffTabId("w1", { kind: "working-tree" }, "src/a.ts");
	const staged = diffTabId("w1", { kind: "staged" }, "src/a.ts");
	expect(working).not.toBe(staged);
	// The tab tag is the human label lowercased ("working tree", not the raw kind "working-tree") — it is
	// user-facing text in a tab strip.
	expect(diffTabName({ kind: "working-tree" }, "src/a.ts")).toBe("a.ts · working tree");
	expect(diffTabName({ kind: "staged" }, "src/a.ts")).toBe("a.ts · staged");
});

test("splitPath separates the muted directory prefix from the bright basename", () => {
	expect(splitPath("apps/web/src/a.ts")).toEqual({ dir: "apps/web/src/", base: "a.ts" });
	expect(splitPath("README.md")).toEqual({ dir: "", base: "README.md" });
});

test("the comparison target names the other side, and is live only for branch scope", () => {
	expect(comparisonTargetLabel({ kind: "branch" }, "main")).toEqual({
		label: "main",
		interactive: true,
	});
	expect(comparisonTargetLabel({ kind: "working-tree" }, "main")).toEqual({
		label: "index",
		interactive: false,
	});
	expect(comparisonTargetLabel({ kind: "staged" }, "main")).toEqual({
		label: "HEAD",
		interactive: false,
	});
	expect(comparisonTargetLabel({ kind: "commit", sha: "abc1234" }, "main")).toEqual({
		label: "— (parent)",
		interactive: false,
	});
	expect(comparisonTargetLabel({ kind: "pinned", baseRef: "deadbeef1234" }, "main")).toEqual({
		label: "deadbee",
		interactive: false,
	});
});

test("the read key carries the diff base only for the scope whose range uses it", () => {
	// Branch scope is measured from merge-base(target, HEAD) — re-pointing the target changes the answer,
	// so the target belongs to the read's identity.
	expect(changesReadKey({ kind: "branch" }, "main")).not.toBe(
		changesReadKey({ kind: "branch" }, "develop"),
	);

	// The other four ranges (index→disk, HEAD→index, sha^→sha, HEAD→worktree) cannot move when the target is
	// re-pointed, so their keys must be base-independent — otherwise a re-point resets the list to Loading…
	// and re-reads for a diff that provably could not change.
	for (const scope of [
		{ kind: "working-tree" } as const,
		{ kind: "staged" } as const,
		{ kind: "commit", sha: "abc1234" } as const,
		{ kind: "uncommitted" } as const,
	]) {
		expect(changesReadKey(scope, "main")).toBe(changesReadKey(scope, "develop"));
	}

	// Distinct scopes still key distinctly — the key must not collapse two scopes into one read.
	const keys = [
		changesReadKey({ kind: "branch" }, "main"),
		changesReadKey({ kind: "working-tree" }, "main"),
		changesReadKey({ kind: "staged" }, "main"),
		changesReadKey({ kind: "commit", sha: "abc1234" }, "main"),
		changesReadKey({ kind: "uncommitted" }, "main"),
	];
	expect(new Set(keys).size).toBe(5);
});
