import { expect, test } from "bun:test";
import type { GitFileChange, RemoteState } from "@thinkrail/contracts";
import {
	buildChangesTree,
	type ChangeTreeDir,
	changesReadKey,
	comparisonTargetLabel,
	diffTabId,
	diffTabName,
	isDiffTabId,
	remoteIndicatorView,
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
	expect(scopeKey({ kind: "commit", sha: "abc123" })).toBe("commit:abc123");

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
	expect(diffTabName({ kind: "commit", sha: "abc1234567" }, "src/a.ts")).toBe("a.ts · abc1234");
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
	// The non-commit path (`Diff scope: <label>`) — the tooltip's only case since `uncommitted` was removed.
	expect(scopeTitle({ kind: "branch" })).toBe("Diff scope: All changes");
	// The pill never carries a commit *subject* — a sentence there would crowd the comparison target beside
	// it down toward its own ellipsis.
	expect(scopeLabel({ kind: "commit", sha: "abc1234567" }, commits)).toBe("abc1234");
	expect(scopeLabel({ kind: "commit", sha: "abc1234567" })).toBe("abc1234");
	// The subject lives in the tooltip (and the menu row), where there is room for it.
	expect(scopeTitle({ kind: "commit", sha: "abc1234567" }, commits)).toBe(
		"abc1234 · Fix the thing",
	);
	expect(scopeTitle({ kind: "commit", sha: "abc1234567" })).toBe("abc1234");
});

test("scopeLabel names the two dirty-worktree halves distinctly", () => {
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
});

test("the read key carries the diff base only for the scope whose range uses it", () => {
	// Branch scope is measured from merge-base(target, HEAD) — re-pointing the target changes the answer,
	// so the target belongs to the read's identity.
	expect(changesReadKey({ kind: "branch" }, "main")).not.toBe(
		changesReadKey({ kind: "branch" }, "develop"),
	);

	// The other three ranges (index→disk, HEAD→index, sha^→sha) cannot move when the target is
	// re-pointed, so their keys must be base-independent — otherwise a re-point resets the list to Loading…
	// and re-reads for a diff that provably could not change.
	for (const scope of [
		{ kind: "working-tree" } as const,
		{ kind: "staged" } as const,
		{ kind: "commit", sha: "abc1234" } as const,
	]) {
		expect(changesReadKey(scope, "main")).toBe(changesReadKey(scope, "develop"));
	}

	// Distinct scopes still key distinctly — the key must not collapse two scopes into one read.
	const keys = [
		changesReadKey({ kind: "branch" }, "main"),
		changesReadKey({ kind: "working-tree" }, "main"),
		changesReadKey({ kind: "staged" }, "main"),
		changesReadKey({ kind: "commit", sha: "abc1234" }, "main"),
	];
	expect(new Set(keys).size).toBe(4);
});

// ---- remoteIndicatorView: the `↓` indicator's three-fidelity + dormancy rendering ----------------------

function remote(patch: Partial<RemoteState> = {}): RemoteState {
	return { projectId: "p1", ref: "origin/main", behind: null, lastCheckedAt: null, ...patch };
}

test("remoteIndicatorView renders each `behind` fidelity distinctly when actively checked", () => {
	// A number (fetch mode) → `↓·N`, never collapsed to the bare arrow.
	expect(remoteIndicatorView(remote({ behind: 3 }))).toEqual(
		expect.objectContaining({ kind: "behind", text: "↓·3", muted: false }),
	);
	// `"unknown"` (probe mode) → the bare arrow, honest about not having a count.
	expect(remoteIndicatorView(remote({ behind: "unknown" }))).toEqual(
		expect.objectContaining({ kind: "behind", text: "↓", muted: false }),
	);
	// `null`, no dormant reason → up to date, nothing to render at all.
	expect(remoteIndicatorView(remote({ behind: null }))).toBeNull();
});

test("remoteIndicatorView never collapses `unknown` into `0` or `null`", () => {
	// The regression this guards: a `0` reads as "checked, definitely 0 behind" — a claim probe mode cannot
	// make — and collapsing into `null` (nothing rendered) hides that the remote differs at all.
	const unknown = remoteIndicatorView(remote({ behind: "unknown" }));
	const zero = remoteIndicatorView(remote({ behind: 0 }));
	expect(unknown?.kind === "behind" ? unknown.text : null).not.toBe(
		zero?.kind === "behind" ? zero.text : null,
	);
	expect(unknown).not.toBeNull();
});

test("remoteIndicatorView renders upstream-gone as a warning, never as bare absence", () => {
	// The Critical review finding this guards: `dormant: "upstream-gone"` paired with `behind: null` must not
	// render as "nothing to show" (indistinguishable from up to date) — it needs its own reason.
	const view = remoteIndicatorView(remote({ behind: null, dormant: "upstream-gone" }));
	expect(view?.kind).toBe("warning");
	expect(view && "reason" in view ? view.reason.length > 0 : false).toBe(true);
});

test("remoteIndicatorView surfaces every other dormancy reason, muted rather than swallowed", () => {
	for (const dormant of [
		"disabled",
		"never-authenticated",
		"ssh-agent-present",
		"failing",
	] as const) {
		// No count ever having landed (behind: null) still has to render *something* — the tooltip explaining
		// why is unreachable if there is nothing on screen to open it from.
		const view = remoteIndicatorView(remote({ behind: null, dormant }));
		expect(view).toEqual(
			expect.objectContaining({
				kind: "behind",
				text: "↓",
				muted: true,
				reason: expect.any(String),
			}),
		);
		// A real count from before the pair went dormant is never hidden — only muted.
		const withCount = remoteIndicatorView(remote({ behind: 2, dormant }));
		expect(withCount).toEqual(
			expect.objectContaining({
				kind: "behind",
				text: "↓·2",
				muted: true,
				reason: expect.any(String),
			}),
		);
	}
});

// ---- remoteIndicatorView surfaces `lastCheckedAt` in the reason text (never rendered before) ------------

test("remoteIndicatorView appends a relative 'last checked' note whenever lastCheckedAt is known", () => {
	const fiveMinutesAgo = new Date(Date.now() - 5 * 60_000).toISOString();

	// Actively-checked, genuinely behind.
	const behind = remoteIndicatorView(remote({ behind: 3, lastCheckedAt: fiveMinutesAgo }));
	expect(behind?.kind === "behind" ? behind.reason : "").toContain("5m ago");

	// A dormant reason with a real prior check (e.g. "failing" after backing off from a past success).
	const dormant = remoteIndicatorView(
		remote({ behind: null, dormant: "failing", lastCheckedAt: fiveMinutesAgo }),
	);
	expect(dormant?.kind === "behind" ? dormant.reason : "").toContain("5m ago");

	// upstream-gone: the completed check that discovered the branch is gone still has a timestamp.
	const gone = remoteIndicatorView(
		remote({ behind: null, dormant: "upstream-gone", lastCheckedAt: fiveMinutesAgo }),
	);
	expect(gone?.kind === "warning" ? gone.reason : "").toContain("5m ago");
});

test("remoteIndicatorView never fabricates a 'last checked' note when lastCheckedAt is null", () => {
	// never-authenticated, fresh: nothing has ever completed a check for this pair.
	const view = remoteIndicatorView(
		remote({ behind: null, dormant: "never-authenticated", lastCheckedAt: null }),
	);
	expect(view?.kind === "behind" ? view.reason : "").not.toContain("Last checked");
});
