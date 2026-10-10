import { expect, test } from "bun:test";
import type { GitFileChange } from "@thinkrail/contracts";
import {
	buildChangesTree,
	type ChangeTreeDir,
	changesTabId,
	changesTabName,
	diffTabId,
	diffTabName,
	estimatedSectionHeight,
	scopeKey,
	scopeLabel,
	scopeTitle,
	sectionCollapsedByDefault,
	splitPath,
	turnScope,
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

test("changesTabId: one review tab per (workspace, scope), disjoint from every diff tab id", () => {
	const branch = changesTabId("ws1", { kind: "branch" });
	expect(branch).toBe("changes:3:ws16:branch");
	expect(changesTabId("ws1", { kind: "commit", sha: "abc123" })).not.toBe(branch);
	expect(changesTabId("ws2", { kind: "branch" })).not.toBe(branch);
	expect(branch.startsWith("diff:")).toBe(false);
	expect(changesTabName({ kind: "branch" })).toBe("Changes");
	expect(changesTabName({ kind: "uncommitted" })).toBe("Changes · uncommitted");
	expect(changesTabName({ kind: "commit", sha: "abc1234567" })).toBe("Changes · abc1234");
});

test("sectionCollapsedByDefault folds large and generated files, never an ordinary source change", () => {
	expect(sectionCollapsedByDefault(change("src/a.ts", { added: 300, removed: 100 }))).toBe(false);
	expect(sectionCollapsedByDefault(change("src/a.ts", { added: 300, removed: 101 }))).toBe(true);
	expect(sectionCollapsedByDefault(change("bun.lock"))).toBe(true);
	expect(sectionCollapsedByDefault(change("web/package-lock.json"))).toBe(true);
	expect(sectionCollapsedByDefault(change("dist/app.min.js"))).toBe(true);
	expect(sectionCollapsedByDefault(change("src/__snapshots__/a.test.ts.snap"))).toBe(true);
	expect(sectionCollapsedByDefault(change("src/lockfile.ts"))).toBe(false);
	expect(
		sectionCollapsedByDefault(change("docs/notes.md", { added: undefined, removed: undefined })),
	).toBe(false);
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

test("a turn scope is keyed by its id, labelled Last turn only while it is the newest, and read-only", () => {
	const older = {
		id: "s1:100",
		workspaceId: "ws1",
		sessionId: "s1",
		startedAt: 100,
		settledAt: 200,
		baseTree: "a".repeat(40),
		headTree: "b".repeat(40),
		changes: [change("src/a.ts")],
	};
	const newer = {
		...older,
		id: "s1:300",
		startedAt: 300,
		settledAt: 400,
		headTree: "c".repeat(40),
	};
	const scope = turnScope(older);
	expect(scope).toEqual({
		kind: "turn",
		id: "s1:100",
		baseTree: older.baseTree,
		headTree: older.headTree,
		startedAt: 100,
	});
	expect(scopeKey(scope)).toBe("turn:s1:100");
	expect(diffTabId("ws1", scope, "src/a.ts")).not.toBe(
		diffTabId("ws1", turnScope(newer), "src/a.ts"),
	);
	expect(scopeLabel(turnScope(newer), [], [older, newer])).toBe("Last turn");
	expect(scopeLabel(scope, [], [older, newer])).toMatch(/^Turn /);
	expect(scopeTitle(scope, [], [older, newer])).toMatch(/^Agent turn at .* · 1 file$/);
	expect(changesTabName(scope)).toMatch(/^Changes · turn /);
	expect(diffTabName(scope, "src/a.ts")).toMatch(/^a\.ts · turn /);
});

test("a loading section reserves a height in the order of its eventual diff", () => {
	const chrome = estimatedSectionHeight({ path: "img.png", status: "modified" });
	const small = estimatedSectionHeight({ path: "a.ts", status: "modified", added: 1, removed: 1 });
	const medium = estimatedSectionHeight({
		path: "b.ts",
		status: "modified",
		added: 52,
		removed: 2,
	});
	const huge = estimatedSectionHeight({
		path: "c.ts",
		status: "modified",
		added: 9000,
		removed: 9000,
	});
	expect(chrome).toBeGreaterThan(0);
	expect(small).toBeGreaterThan(chrome);
	expect(medium).toBeGreaterThan(small);
	expect(medium).toBeGreaterThan(1500);
	expect(medium).toBeLessThan(4000);
	expect(huge).toBe(20_000);
});
