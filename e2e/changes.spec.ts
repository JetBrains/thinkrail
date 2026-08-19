import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Locator, test } from "@playwright/test";
import { createWorkspaceViaDialog, openFixtureProject, worktreeRows } from "./fixtures/app";
import { E2E_DATA_DIR, E2E_FIXTURE_REPO } from "./fixtures/paths";
import { largeRepetitiveMarkdownEdited } from "./fixtures/repo";

test("Changes tab shows the active worktree's diff and swaps per workspace", async ({ page }) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	await expect(worktreeRows(page)).toHaveCount(1); // the always-present Default is counted separately

	// Edit a tracked file inside the worktree (outside the app), then surface it in the Changes tab.
	const worktree = join(E2E_DATA_DIR, "worktrees", "sample-project", "workspace-1");
	writeFileSync(join(worktree, "README.md"), "# sample-project\n\nedited by e2e\n");

	await page.getByTestId("tab-changes").click();
	const changed = page.getByTestId("change-item").filter({ hasText: "README.md" });
	await expect(changed).toHaveAttribute("data-status", "modified");

	// Clicking a changed file opens its Monaco diff tab in the center (split view by default).
	await changed.click();
	const diffTab = page.locator('[data-testid="editor-tab"][data-kind="diff"]');
	await expect(diffTab).toHaveCount(1);
	await expect(diffTab).toHaveAttribute("data-active", "true");
	await expect(page.getByTestId("diff-pane")).toContainText("edited by e2e");

	// A markdown diff has exactly two views: Source (basic Monaco split, the default) | Rendered
	// (one htmldiff-merged rendered document with ins/del markers). No Split|Inline segment.
	await expect(page.getByTestId("diff-toggle-source")).toHaveAttribute("data-active", "true");
	await expect(page.getByTestId("diff-toggle-split")).toHaveCount(0);
	await page.getByTestId("diff-toggle-rendered").click();
	await expect(page.getByTestId("diff-toggle-rendered")).toHaveAttribute("data-active", "true");
	const renderedDiff = page.getByTestId("rendered-diff");
	await expect(renderedDiff.locator("h1")).toHaveText("sample-project");
	await expect(renderedDiff.locator("ins")).toContainText("edited by e2e");

	// Switching back to Source returns to the raw Monaco diff.
	await page.getByTestId("diff-toggle-source").click();
	await expect(page.getByTestId("diff-toggle-source")).toHaveAttribute("data-active", "true");
	await expect(renderedDiff).toHaveCount(0);

	// Re-clicking the row focuses the existing tab — one diff tab per file, never a duplicate.
	await changed.click();
	await expect(diffTab).toHaveCount(1);

	// A non-markdown diff has no Source|Rendered — just Split | Inline (per-tab).
	writeFileSync(join(worktree, "script.ts"), "export const edited = true;\n");
	await page.getByTestId("change-item").filter({ hasText: "script.ts" }).click();
	await expect(page.getByTestId("diff-pane")).toContainText("edited = true");
	await expect(page.getByTestId("diff-toggle-split")).toHaveAttribute("data-active", "true");
	await expect(page.getByTestId("diff-toggle-rendered")).toHaveCount(0);
	await page.getByTestId("diff-toggle-inline").click();
	await expect(page.getByTestId("diff-toggle-inline")).toHaveAttribute("data-active", "true");
	await expect(page.getByTestId("diff-pane")).toContainText("edited = true");

	// A fresh second workspace has its own (empty) change set. Its new terminal is selected on creation,
	// so choose the sibling Changes tab explicitly in the synchronized side group.
	await createWorkspaceViaDialog(page);
	await expect(worktreeRows(page)).toHaveCount(2);
	await page.getByTestId("tab-changes").click();
	await expect(page.getByTestId("changes-empty")).toBeVisible();
});

test("Rendered markdown diff of a large repetitive file never blocks the main thread", async ({
	page,
}) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);

	// Edit the seeded 800-identical-row doc (one mid-document row replaced + one appended), so BOTH
	// diff sides are large stretches of identical rows — node-htmldiff's worst case (multi-second
	// synchronous merge). The merge now runs in a Web Worker (see panels/RenderedDiff).
	const worktree = join(E2E_DATA_DIR, "worktrees", "sample-project", "workspace-1");
	writeFileSync(join(worktree, "LARGE.md"), largeRepetitiveMarkdownEdited());

	await page.getByTestId("tab-changes").click();
	await page.getByTestId("change-item").filter({ hasText: "LARGE.md" }).click();
	await expect(page.getByTestId("diff-pane")).toBeVisible();

	// Record main-thread stalls from just before the Rendered toggle: any synchronous htmldiff run
	// would show up as one huge long task.
	await page.evaluate(() => {
		const w = window as unknown as { __maxLongTask: number };
		w.__maxLongTask = 0;
		new PerformanceObserver((list) => {
			for (const entry of list.getEntries())
				w.__maxLongTask = Math.max(w.__maxLongTask, entry.duration);
		}).observe({ type: "longtask" });
	});

	await page.getByTestId("diff-toggle-rendered").click();
	// Async contract: a placeholder while the worker computes, then the merged document.
	await expect(page.getByTestId("rendered-diff-loading")).toBeVisible();
	const renderedDiff = page.getByTestId("rendered-diff");
	await expect(renderedDiff.locator("ins").filter({ hasText: "EDITED" }).first()).toBeVisible({
		timeout: 60_000,
	});
	await expect(renderedDiff.locator("del").filter({ hasText: "alpha" }).first()).toBeVisible();

	// The heavy merge ran off the main thread: nothing blocked anywhere near the multi-second freeze
	// the inline merge produced for this exact input (~7s). Budget is generous for slow CI — the only
	// remaining main-thread work is the linear static-markup render of both sides.
	const maxLongTask = await page.evaluate(
		() => (window as unknown as { __maxLongTask: number }).__maxLongTask,
	);
	expect(maxLongTask).toBeLessThan(1000);
});

test("Rendered markdown diff shows an error placeholder when the merge worker fails", async ({
	page,
}) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);

	const worktree = join(E2E_DATA_DIR, "worktrees", "sample-project", "workspace-1");
	writeFileSync(join(worktree, "README.md"), "# sample-project\n\nedited by e2e\n");

	await page.getByTestId("tab-changes").click();
	await page.getByTestId("change-item").filter({ hasText: "README.md" }).click();
	await expect(page.getByTestId("diff-pane")).toBeVisible();

	// Kill the worker script asset (deploy-skew / offline shape) — only htmldiff's worker, not the
	// RenderedDiff chunk or Monaco's own workers. The Worker object's `onerror` must resolve the view
	// to the error placeholder, never an eternal "Rendering diff…" spinner.
	await page.route(/htmldiff\.worker/, (route) => route.abort());
	await page.getByTestId("diff-toggle-rendered").click();
	await expect(page.getByTestId("rendered-diff-error")).toBeVisible();
	await expect(page.getByTestId("rendered-diff-error")).toContainText("Source");

	// The Source view stays a working escape hatch.
	await page.getByTestId("diff-toggle-source").click();
	await expect(page.getByTestId("diff-pane")).toContainText("edited by e2e");
});

test("Rendered markdown diff follows live edits on disk (stale merge cancelled, fresh one lands)", async ({
	page,
}) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);

	const worktree = join(E2E_DATA_DIR, "worktrees", "sample-project", "workspace-1");
	writeFileSync(join(worktree, "README.md"), "# sample-project\n\nfirst edit by e2e\n");

	await page.getByTestId("tab-changes").click();
	await page.getByTestId("change-item").filter({ hasText: "README.md" }).click();
	await page.getByTestId("diff-toggle-rendered").click();
	const renderedDiff = page.getByTestId("rendered-diff");
	await expect(renderedDiff.locator("ins").filter({ hasText: "first edit by e2e" })).toBeVisible();

	// Edit the file on disk while the rendered view is open: the workspace fs tick re-reads both diff
	// sides (useLiveTabContent), which cancels the previous merge (worker terminated on input change)
	// and lands a fresh one — the rendered document follows without any manual refresh.
	writeFileSync(join(worktree, "README.md"), "# sample-project\n\nsecond edit by e2e\n");
	await expect(renderedDiff.locator("ins").filter({ hasText: "second edit by e2e" })).toBeVisible();
	await expect(renderedDiff).not.toContainText("first edit by e2e");
});

test("Changes has a List|Tree toggle; Tree groups files into folders with +/- counts", async ({
	page,
}) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);

	// A changed file inside a single-directory run, so the tree compacts the folder chain into one row.
	const worktree = join(E2E_DATA_DIR, "worktrees", "sample-project", "workspace-1");
	mkdirSync(join(worktree, "docs", "guides"), { recursive: true });
	writeFileSync(join(worktree, "docs", "guides", "notes.md"), "one\ntwo\nthree\n");

	await page.getByTestId("tab-changes").click();
	// List is the default view.
	await expect(page.getByTestId("changes-toggle-list")).toHaveAttribute("data-active", "true");
	await expect(
		page.getByTestId("change-item").filter({ hasText: "docs/guides/notes.md" }),
	).toBeVisible();

	// Switch to the folder tree.
	await page.getByTestId("changes-toggle-tree").click();
	await expect(page.getByTestId("changes-toggle-tree")).toHaveAttribute("data-active", "true");

	// One default-expanded `docs/guides` row represents the whole run; no row is spent per segment.
	const compactFolder = page.getByTestId("change-tree-folder");
	await expect(compactFolder).toHaveCount(1);
	await expect(compactFolder).toContainText("docs/guides");
	const fileNode = page.getByTestId("change-node").filter({ hasText: "notes.md" });
	await expect(fileNode).toBeVisible();
	await compactFolder.click();
	await expect(fileNode).toBeHidden();
	await compactFolder.click();
	await expect(fileNode).toBeVisible();
	await expect(fileNode).toHaveAttribute("data-status", "untracked");
	await expect(fileNode).toContainText("+3");

	// Clicking a file in the tree opens its diff tab, exactly like the list.
	await fileNode.click();
	const diffTab = page.locator('[data-testid="editor-tab"][data-kind="diff"]');
	await expect(diffTab).toHaveCount(1);
	await expect(page.getByTestId("diff-pane")).toContainText("three");

	// The view choice is app-wide: leaving Changes and returning keeps Tree selected.
	await page.getByTestId("tab-files").click();
	await page.getByTestId("tab-changes").click();
	await expect(page.getByTestId("changes-toggle-tree")).toHaveAttribute("data-active", "true");
});

/** Run a git command inside a worktree (the fixtures the scope selector needs are made with real git). */
function gitIn(cwd: string, ...args: string[]): void {
	execFileSync("git", ["-C", cwd, ...args], { stdio: "ignore" });
}

/** The seeded worktree of the suite's first created workspace. */
function worktreeDir(): string {
	return join(E2E_DATA_DIR, "worktrees", "sample-project", "workspace-1");
}

/**
 * A worktree with **both** kinds of change the scope selector distinguishes: one commit on the workspace's
 * own branch (`committed.txt`), plus an uncommitted edit of a tracked file (`README.md`).
 */
function seedCommitAndDirtyEdit(): string {
	const worktree = worktreeDir();
	writeFileSync(join(worktree, "committed.txt"), "committed by e2e\n");
	gitIn(worktree, "add", "committed.txt");
	gitIn(
		worktree,
		"-c",
		"user.email=e2e@thinkrail.test",
		"-c",
		"user.name=ThinkRail E2E",
		"commit",
		"-m",
		"e2e scope commit",
	);
	writeFileSync(join(worktree, "README.md"), "# sample-project\n\ndirty edit by e2e\n");
	return worktree;
}

test("Changes scope selector filters by commit / uncommitted; each scope is its own diff tab", async ({
	page,
}) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	seedCommitAndDirtyEdit();

	await page.getByTestId("tab-changes").click();
	// The default scope is everything on the branch: the commit's file AND the dirty edit.
	await expect(page.getByTestId("changes-scope-label")).toHaveText("All changes");
	await expect(page.getByTestId("change-item")).toHaveCount(2);

	// The menu lists the branch's commits (subject + short sha), fetched lazily on first open.
	await page.getByTestId("changes-scope-trigger").click();
	const commitRow = page
		.getByTestId("changes-scope-commit")
		.filter({ hasText: "e2e scope commit" });
	await expect(commitRow).toHaveCount(1);
	await commitRow.click();
	// Picking it narrows the list to that commit alone — the dirty worktree edit is not part of it.
	// The pill reads the commit's short sha (its subject is the tooltip — see the header-readability spec).
	await expect(page.getByTestId("changes-scope-label")).toHaveText(/^[0-9a-f]{7,}$/);
	await expect(page.getByTestId("change-item")).toHaveCount(1);
	await expect(page.getByTestId("change-item").first()).toContainText("committed.txt");

	// Uncommitted shows only the dirty file.
	await page.getByTestId("changes-scope-trigger").click();
	await page.getByTestId("changes-scope-uncommitted").click();
	await expect(page.getByTestId("changes-scope-label")).toHaveText("Uncommitted");
	await expect(page.getByTestId("change-item")).toHaveCount(1);
	const readme = page.getByTestId("change-item").filter({ hasText: "README.md" });
	await expect(readme).toHaveCount(1);

	// The scope is part of a diff tab's identity: the same file in two scopes is TWO tabs (a tab's content must
	// never change meaning because the rail's scope flipped underneath it). **Double**-clicked, so the first is
	// KEPT — a second single click would land in the workspace's preview slot and replace it, which is the
	// preview-tab rule, not a scope-identity failure.
	await readme.dblclick();
	const diffTabs = page.locator('[data-testid="editor-tab"][data-kind="diff"]');
	await expect(diffTabs).toHaveCount(1);
	await page.getByTestId("changes-scope-trigger").click();
	await page.getByTestId("changes-scope-all").click();
	await expect(page.getByTestId("changes-scope-label")).toHaveText("All changes");
	await page.getByTestId("change-item").filter({ hasText: "README.md" }).dblclick();
	await expect(diffTabs).toHaveCount(2);
});

// The `uncommitted` scope is the one scope whose content depends on a **ref**, not on worktree files: its
// `HEAD` can move while every file on disk stays byte-identical (a `git commit` in the workspace's terminal
// stages nothing new to see). A linked worktree's git metadata even lives in the *parent* repo, outside the
// watched root — so without the host's git-metadata watch this panel would keep calling the just-committed
// files "uncommitted" until some unrelated file edit happened to nudge it.
test("Uncommitted scope converges when HEAD moves out-of-band (a commit in a terminal)", async ({
	page,
}) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	const worktree = seedCommitAndDirtyEdit();
	// A dirty edit of a tracked NON-markdown file, so the diff opens in Monaco rather than the rendered
	// markdown view — this spec reads the diff's two sides as text.
	writeFileSync(join(worktree, "committed.txt"), "committed by e2e\ndirty line by e2e\n");

	await page.getByTestId("tab-changes").click();
	await page.getByTestId("changes-scope-trigger").click();
	await page.getByTestId("changes-scope-uncommitted").click();
	const dirtyRow = page.getByTestId("change-item").filter({ hasText: "committed.txt" });
	await expect(dirtyRow).toHaveCount(1);

	// …with that file's diff open and ACTIVE, so the tab-content contract is under test too, not just the
	// list. The dirty line appears ONCE while the edit is uncommitted (the modified side only); once it is
	// committed, `HEAD` carries it as well, so an honest re-read shows it on BOTH sides.
	await dirtyRow.dblclick();
	// Monaco renders spaces as NBSP, so the pane's raw text is whitespace-normalized before counting.
	const dirtyLineCount = async () => {
		const text = ((await page.getByTestId("diff-pane").textContent()) ?? "").replace(/\s+/g, " ");
		return (text.match(/dirty line by e2e/g) ?? []).length;
	};
	await expect.poll(dirtyLineCount, { timeout: 15_000 }).toBe(1);

	// Wait out the watcher's one-shot startup nudge (~750ms after it registers) first: it would refetch the
	// panel for unrelated reasons and hide the very staleness this asserts.
	await new Promise((r) => setTimeout(r, 1500));

	// Commit the dirty files — HEAD moves, the worktree does not.
	gitIn(worktree, "add", "-A");
	gitIn(
		worktree,
		"-c",
		"user.email=e2e@thinkrail.test",
		"-c",
		"user.name=ThinkRail E2E",
		"commit",
		"-m",
		"e2e commits the dirty edits",
	);

	// No click, no refresh: the ref-move nudge alone empties the scope. (Generous window — the same
	// watch → debounce → push → re-read chain the live-refresh spec allows 10s for.)
	await expect(page.getByTestId("change-item")).toHaveCount(0, { timeout: 10_000 });
	await expect(page.getByTestId("changes-empty")).toBeVisible();
	// …and the open diff tab re-read against the new `HEAD` rather than advancing its tick on a frame that
	// named no file (the pathless nudge is exactly the case path membership cannot answer).
	await expect.poll(dirtyLineCount, { timeout: 10_000 }).toBe(2);
});

test("The scope menu's target-branch picker re-points what the changes are measured against", async ({
	page,
}) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	seedCommitAndDirtyEdit();

	await page.getByTestId("tab-changes").click();
	await expect(page.getByTestId("change-item")).toHaveCount(2);

	// Re-point the target at the workspace's own branch: everything committed on it is then common
	// ground, so only the uncommitted edit is left — and the picker marks the new target.
	await page.getByTestId("changes-target-picker").click();
	await page.locator('[data-testid="branch-option"][data-branch="workspace-1"]').click();
	await expect(page.getByTestId("change-item")).toHaveCount(1);
	await expect(page.getByTestId("change-item").first()).toContainText("README.md");

	await expect(page.getByTestId("changes-target-picker")).toContainText("workspace-1");
	await page.getByTestId("changes-target-picker").click();
	await expect(
		page.locator('[data-testid="branch-option"][data-branch="workspace-1"]'),
	).toHaveAttribute("data-active", "true");
});

test("A target that advanced past the fork point adds no phantom changes (merge-base semantics)", async ({
	page,
}) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	seedCommitAndDirtyEdit();

	// A branch that is main + one commit the workspace never saw ("upstream" work) — built in a throwaway
	// git worktree so the shared fixture's main checkout is never disturbed. Self-cleaning: resetState
	// prunes stray worktrees and deletes every non-main branch.
	const upstreamWt = join(E2E_DATA_DIR, "worktrees", "e2e-upstream");
	gitIn(E2E_FIXTURE_REPO, "worktree", "add", upstreamWt, "-b", "future-main", "main");
	writeFileSync(join(upstreamWt, "upstream.txt"), "landed on the base after the fork\n");
	gitIn(upstreamWt, "add", "upstream.txt");
	gitIn(
		upstreamWt,
		"-c",
		"user.email=e2e@thinkrail.test",
		"-c",
		"user.name=ThinkRail E2E",
		"commit",
		"-m",
		"upstream work",
	);

	await page.getByTestId("tab-changes").click();
	await expect(page.getByTestId("change-item")).toHaveCount(2); // committed.txt + README.md

	// Re-point the target at the advanced branch. Tip semantics would now claim upstream.txt as a phantom
	// deletion — a file this workspace never touched; measuring from the merge-base (the fork point) keeps
	// the list at exactly the workspace's own work.
	await page.getByTestId("changes-target-picker").click();
	await page.locator('[data-testid="branch-option"][data-branch="future-main"]').click();
	await expect(page.getByTestId("changes-target-picker")).toContainText("future-main");

	// Convergence signal: a fresh own edit must appear via the fs tick — that landed read was taken
	// against the new target, which makes the phantom's absence a claim about the NEW range, not a stale
	// list. (Under tip semantics this same read would surface upstream.txt as a fourth, deleted row.)
	writeFileSync(join(worktreeDir(), "own-file.txt"), "still just my work\n");
	await expect(page.getByTestId("change-item")).toHaveCount(3);
	await expect(page.getByTestId("change-item").filter({ hasText: "own-file.txt" })).toHaveCount(1);
	await expect(page.getByTestId("change-item").filter({ hasText: "upstream.txt" })).toHaveCount(0);
});

test("A change row's action menu opens from the ⌄ button and from right-click; Copy path writes the relative path", async ({
	page,
	context,
}) => {
	await context.grantPermissions(["clipboard-read", "clipboard-write"]);
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);

	// A file inside a folder, so the copied path proves it is worktree-relative (not a basename).
	const worktree = worktreeDir();
	mkdirSync(join(worktree, "docs"), { recursive: true });
	writeFileSync(join(worktree, "docs", "notes.md"), "one\ntwo\n");

	await page.getByTestId("tab-changes").click();
	const row = page.getByTestId("change-item").filter({ hasText: "docs/notes.md" });
	await expect(row).toBeVisible();

	// The hover/focus-revealed ⌄ trigger — the touch path, where right-click doesn't exist.
	await row.hover();
	await page.getByTestId("change-row-menu").click();
	await expect(page.getByTestId("change-row-actions")).toBeVisible();
	await page.getByTestId("change-action-copy-path").click();
	expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("docs/notes.md");

	// Right-click on the row opens the same menu; View is the same action as a plain click.
	await row.click({ button: "right" });
	await expect(page.getByTestId("change-row-actions")).toBeVisible();
	await page.getByTestId("change-action-view").click();
	await expect(page.locator('[data-testid="editor-tab"][data-kind="diff"]')).toHaveCount(1);
	await expect(page.getByTestId("diff-pane")).toContainText("two");

	// The folder tree offers the row menu on files too — and never on a folder row.
	await page.getByTestId("changes-toggle-tree").click();
	const fileNode = page.getByTestId("change-node").filter({ hasText: "notes.md" });
	await fileNode.click({ button: "right" });
	await expect(page.getByTestId("change-row-actions")).toBeVisible();
	await page.keyboard.press("Escape");
	await page
		.getByTestId("change-tree-folder")
		.filter({ hasText: "docs" })
		.click({ button: "right" });
	await expect(page.getByTestId("change-row-actions")).toHaveCount(0);
});

test("The diff viewer collapses unchanged context and has a per-tab hide-whitespace + copy header", async ({
	page,
	context,
}) => {
	await context.grantPermissions(["clipboard-read", "clipboard-write"]);
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);

	// A long tracked file with a single changed line: everything around it is unchanged context, which
	// Monaco's `hideUnchangedRegions` collapses into an expandable "unmodified lines" separator.
	const worktree = worktreeDir();
	const lines = Array.from({ length: 120 }, (_, i) => `export const v${i} = ${i};`);
	writeFileSync(join(worktree, "long.ts"), `${lines.join("\n")}\n`);
	gitIn(worktree, "add", "long.ts");
	gitIn(
		worktree,
		"-c",
		"user.email=e2e@thinkrail.test",
		"-c",
		"user.name=ThinkRail E2E",
		"commit",
		"-m",
		"long file",
	);
	lines[60] = "export const v60 = 6000;";
	writeFileSync(join(worktree, "long.ts"), `${lines.join("\n")}\n`);

	await page.getByTestId("tab-changes").click();
	// The *uncommitted* scope is what makes this a modification of a known file (vs HEAD) rather than a
	// whole-file add against the base branch — i.e. a diff that HAS unchanged context to collapse.
	await page.getByTestId("changes-scope-trigger").click();
	await page.getByTestId("changes-scope-uncommitted").click();
	await page.getByTestId("change-item").filter({ hasText: "long.ts" }).click();
	// The header path is a chip: muted directory prefix + bright basename (here a root-level file).
	await expect(page.getByTestId("diff-path")).toHaveText("long.ts");
	// Collapsed unchanged context — Monaco's own "N hidden lines" separator with an expand control — so a
	// one-line change 60 lines in isn't lost in a wall of identical context.
	await expect(page.getByTestId("diff-pane").locator(".diff-hidden-lines").first()).toHaveText(
		/\d+ hidden lines/,
	);
	await expect(page.getByTestId("diff-pane")).toContainText("6000");

	// ¶ hides whitespace-only changes, per tab.
	const whitespace = page.getByTestId("diff-toggle-whitespace");
	await expect(whitespace).toHaveAttribute("data-active", "false");
	await whitespace.click();
	await expect(whitespace).toHaveAttribute("data-active", "true");

	// Copy puts the worktree side on the clipboard.
	await page.getByTestId("diff-copy").click();
	expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(
		"export const v60 = 6000;",
	);
});

test("Change rows stay one aligned, fully-highlighted row — menu slot included, long names truncated", async ({
	page,
}) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);

	// A deep path with a long basename, plus a root-level file: the two cases that used to break the layout
	// (a `shrink-0` basename pushing the counts out, and the file/folder count columns disagreeing).
	const worktree = worktreeDir();
	mkdirSync(join(worktree, "packages/server/src/git"), { recursive: true });
	writeFileSync(
		join(worktree, "packages/server/src/git/diffScopeResolverImplementationForTheChangesPanel.ts"),
		"export const range = 1;\n",
	);
	writeFileSync(join(worktree, "README.md"), "# sample-project\n\nedited by e2e\n");
	// The case a deep path can't pin: a long ROOT-level basename has no truncatable dir prefix to absorb the
	// overflow, so only a truncatable *basename* keeps it inside the row.
	writeFileSync(
		join(worktree, "diffScopeResolverImplementationForTheChangesPanelAtRootLevel.ts"),
		"export const root = 1;\n",
	);
	// A long dir with a SHORT basename — the case that pins "the dir yields first": here the name fits, so it
	// must survive whole while the prefix truncates.
	mkdirSync(join(worktree, "packages/server/src/git/deeply/nested/for/the/changes/panel"), {
		recursive: true,
	});
	writeFileSync(
		join(worktree, "packages/server/src/git/deeply/nested/for/the/changes/panel/shortName.ts"),
		"export const short = 1;\n",
	);

	await page.getByTestId("tab-changes").click();
	// Selected by their DIR prefix / its absence — both basenames start with `diffScopeResolver`, so a
	// `hasText: "diffScopeResolver"` + `.first()` pair resolved to the *same* (root-level) row and the deep case
	// went unasserted.
	const longRow = page.getByTestId("change-item").filter({ hasText: "ForTheChangesPanel.ts" });
	await expect(longRow).toHaveCount(1);
	const rootRow = page.getByTestId("change-item").filter({ hasText: "AtRootLevel" });
	await expect(rootRow).toHaveCount(1);

	// However long the path, the row's content stays inside the row: the basename truncates instead of
	// pushing the `+N −M` counts (and, in the diff header's twin chip, the ¶/copy controls) out of the box.
	const rowBox = (await page.getByTestId("change-row").first().boundingBox()) ?? { x: 0, width: 0 };
	const overflow = await longRow.evaluate((n) => n.scrollWidth - n.clientWidth);
	expect(overflow).toBeLessThanOrEqual(1);
	expect(await rightEdge(longRow.getByText(/^\+\d+/))).toBeLessThanOrEqual(
		rowBox.x + rowBox.width + 1,
	);
	expect(await rootRow.evaluate((n) => n.scrollWidth - n.clientWidth)).toBeLessThanOrEqual(1);
	expect(await rightEdge(rootRow.getByText(/^\+\d+/))).toBeLessThanOrEqual(
		rowBox.x + rowBox.width + 1,
	);

	// The dir prefix yields FIRST: on a row whose name fits, the prefix truncates and the basename — the part a
	// user scans — stays whole. (Equal shrink truncated both, so this compares the two spans against each
	// other, not a row against itself.)
	const clipped = (locator: Locator) => locator.evaluate((n) => n.scrollWidth - n.clientWidth);
	const shortNameRow = page.getByTestId("change-item").filter({ hasText: "shortName.ts" });
	await expect(shortNameRow).toHaveCount(1);
	expect(await clipped(shortNameRow.getByTestId("change-path-dir"))).toBeGreaterThan(1);
	expect(await clipped(shortNameRow.getByTestId("change-path-base"))).toBeLessThanOrEqual(1);
	// Only when the prefix has nothing left to give does the basename truncate too — which is the deep long-name
	// row, and (with no prefix at all) the root-level one.
	expect(await clipped(longRow.getByTestId("change-path-base"))).toBeGreaterThan(1);
	expect(await clipped(rootRow.getByTestId("change-path-base"))).toBeGreaterThan(1);

	// The whole row is the highlight surface (it has to span the trailing `⌄` slot, or a selected row reads
	// as cut off before its own menu) — so the *wrapper* paints the band and the inner button paints NOTHING.
	// Comparing the wrapper's own box to another wrapper's could never fail; comparing wrapper vs inner button
	// is what pins "one painter, and it's the wide one".
	await longRow.click();
	const activeWrapper = page.locator('[data-testid="change-row"][data-active="true"]');
	await expect(activeWrapper).toHaveCount(1);
	const activeBox = (await activeWrapper.boundingBox()) ?? { width: 0 };
	const innerBox = (await longRow.boundingBox()) ?? { width: 0 };
	expect(activeBox.width).toBeGreaterThan(innerBox.width);
	const background = (locator: Locator) =>
		locator.evaluate((n) => getComputedStyle(n).backgroundColor);
	const wrapperPaint = await background(activeWrapper);
	expect(wrapperPaint).not.toBe("rgba(0, 0, 0, 0)");
	expect(await background(longRow)).toBe("rgba(0, 0, 0, 0)");

	// In the tree, files and folders line their `+N −M` counts up on the same column: a folder has no row
	// menu but reserves the same trailing slot (ROW_MENU_SLOT).
	await page.getByTestId("changes-toggle-tree").click();
	const folderBadge = page.getByTestId("change-tree-folder").filter({ hasText: "packages" });
	const fileBadge = page.getByTestId("change-node").filter({ hasText: "ForTheChangesPanel.ts" });
	const folderRight = await rightEdge(folderBadge);
	const fileRight = await rightEdge(fileBadge);
	expect(Math.abs(folderRight - fileRight)).toBeLessThanOrEqual(1);
});

/** The right edge of a locator's box — for asserting two columns line up. */
async function rightEdge(locator: Locator): Promise<number> {
	const box = await locator.boundingBox();
	if (!box) throw new Error("element has no box");
	return box.x + box.width;
}

test("The diff header keeps its controls on a narrow pane, however long the file's path", async ({
	page,
}) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);

	const worktree = worktreeDir();
	mkdirSync(join(worktree, "packages/server/src/git"), { recursive: true });
	writeFileSync(
		join(worktree, "packages/server/src/git/diffScopeResolverImplementationForTheChangesPanel.ts"),
		"export const range = 1;\n",
	);

	await page.getByTestId("tab-changes").click();
	await page.getByTestId("change-item").filter({ hasText: "diffScopeResolver" }).click();
	await expect(page.getByTestId("diff-pane")).toBeVisible();

	// The path chip must truncate rather than push the ¶ / copy / layout controls out of the header.
	await page.setViewportSize({ width: 620, height: 800 });
	await expect(page.getByTestId("diff-toggle-whitespace")).toBeVisible();
	await expect(page.getByTestId("diff-copy")).toBeVisible();
	await expect(page.getByTestId("diff-toggle-split")).toBeVisible();
	// The chip's *text* must stay inside the chip's own box: a `shrink-0` basename overflows it invisibly to
	// the layout while spilling over the buttons on screen, so the header's own width can't be the check.
	const chipOverflow = await page
		.getByTestId("diff-path")
		.evaluate((n) => n.scrollWidth - n.clientWidth);
	expect(chipOverflow).toBeLessThanOrEqual(1);
});

test("A commit scope keeps the header readable: short sha on the pill, subject in its tooltip", async ({
	page,
}) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	seedCommitAndDirtyEdit();

	await page.getByTestId("tab-changes").click();
	await page.getByTestId("changes-scope-trigger").click();
	await page.getByTestId("changes-scope-commit").filter({ hasText: "e2e scope commit" }).click();

	// The pill shows the sha, NOT the subject — a sentence there squeezed the target-branch pill down to an
	// ellipsis. The subject stays available as the trigger's tooltip.
	const label = page.getByTestId("changes-scope-label");
	await expect(label).toHaveText(/^[0-9a-f]{7,}$/);
	await expect(page.getByTestId("changes-scope-trigger")).toHaveAttribute(
		"title",
		/e2e scope commit/,
	);
	// …and the target-branch pill next to it still reads its ref.
	await expect(page.getByTestId("changes-target-picker")).toContainText("main");
});

test("The scope menu is per workspace: its commit rows never carry over to another worktree", async ({
	page,
}) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	seedCommitAndDirtyEdit();

	await page.getByTestId("tab-changes").click();
	await page.getByTestId("changes-scope-trigger").click();
	await expect(
		page.getByTestId("changes-scope-commit").filter({ hasText: "e2e scope commit" }),
	).toHaveCount(1);
	await page.keyboard.press("Escape");

	// A second (fresh) workspace has no commits of its own — the previous workspace's rows must not linger
	// (the panel is not remounted on a switch, so the menu is keyed by workspace).
	await createWorkspaceViaDialog(page);
	await page.getByTestId("tab-changes").click();
	await page.getByTestId("changes-scope-trigger").click();
	await expect(page.getByTestId("changes-scope-commit")).toHaveCount(0);
	await expect(page.getByRole("menu")).toContainText("No commits on this branch");
});

test("Re-pointing the target branch re-reads an open branch-scope diff tab — active or backgrounded", async ({
	page,
}) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	const worktree = seedCommitAndDirtyEdit();
	// Two targets whose FORK POINTS hold different copies of the file — the observable dimension under
	// merge-base semantics (the original side always comes from the fork point, an ancestor of the
	// workspace, never from a target's own tip). A second workspace commit revises the file, and
	// `e2e-target` parks on the FIRST commit: targeting `main` puts the fork point before the file existed
	// (add-style original), targeting `e2e-target` puts it at the first commit — whose content
	// ("committed by e2e") can appear on screen only through a re-read against that target, so the
	// assertions below fail if the tab does not follow the re-point. (A previous version edited the
	// worktree file instead — which the fs-tick re-read would have shown anyway, so it passed with the
	// target dimension removed entirely.)
	writeFileSync(join(worktree, "committed.txt"), "revised by the workspace\n");
	gitIn(worktree, "add", "committed.txt");
	gitIn(
		worktree,
		"-c",
		"user.email=e2e@thinkrail.test",
		"-c",
		"user.name=ThinkRail E2E",
		"commit",
		"-m",
		"e2e revise commit",
	);
	gitIn(worktree, "branch", "e2e-target", "HEAD~1");

	await page.getByTestId("tab-changes").click();
	// A file changed by the branch's commits — visible in the default (vs base) scope, where the fork point
	// has no copy of it at all, so the diff is an add of the worktree content. Double-clicked: the tab must
	// be KEPT, or the second row below would replace it in the workspace's preview slot.
	const committedRow = page.getByTestId("change-item").filter({ hasText: "committed.txt" });
	await committedRow.dblclick();
	const diffPane = page.getByTestId("diff-pane");
	await expect(diffPane).toContainText("revised by the workspace");
	await expect(diffPane).not.toContainText("committed by e2e");

	// (1) The ACTIVE tab follows a re-point immediately — a branch-scope tab means "this file vs the
	// workspace's current target", it does not wait for the next fs tick. The fork point is now the first
	// commit, so ITS copy becomes the original side.
	await page.getByTestId("changes-target-picker").click();
	await page.locator('[data-testid="branch-option"][data-branch="e2e-target"]').click();
	await expect(diffPane).toContainText("committed by e2e");

	// (2) A BACKGROUNDED tab follows it too. Panes mount only while their tab is active, so the drift has to be
	// detected on activation — which works only because the tab persists the target its content was read
	// against (`DiffTab.loadedTarget`). Park on another diff tab, re-point back, then come back.
	const readmeTab = page.getByTestId("change-item").filter({ hasText: "README.md" });
	await readmeTab.click();
	await expect(diffPane).toContainText("dirty edit by e2e");
	await page.getByTestId("changes-target-picker").click();
	await page.locator('[data-testid="branch-option"][data-branch="main"]').first().click();

	await committedRow.click();
	await expect(diffPane).toContainText("revised by the workspace");
	await expect(diffPane).not.toContainText("committed by e2e");
});

test("A commit scope whose commit is rewritten away falls back to All changes with a toast", async ({
	page,
}) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	const worktree = seedCommitAndDirtyEdit();

	await page.getByTestId("tab-changes").click();
	await page.getByTestId("changes-scope-trigger").click();
	await page.getByTestId("changes-scope-commit").filter({ hasText: "e2e scope commit" }).click();
	await expect(page.getByTestId("changes-scope-label")).toHaveText(/^[0-9a-f]{7,}$/);

	// Drop the commit from the repo entirely (reset + expire the reflog), then nudge the watcher: the host
	// answers the scoped read with the named UNKNOWN_COMMIT failure, which is the ONE failure that resets the
	// scope — and it says so instead of silently showing a different scope.
	gitIn(worktree, "reset", "--hard", "HEAD~1");
	gitIn(worktree, "reflog", "expire", "--expire=now", "--all");
	gitIn(worktree, "gc", "--prune=now");
	writeFileSync(join(worktree, "nudge.txt"), "nudge the watcher\n");

	await expect(page.getByTestId("changes-scope-label")).toHaveText("All changes", {
		timeout: 15_000,
	});
	await expect(
		page.getByTestId("toast").filter({ hasText: "no longer in this branch" }),
	).toBeVisible();
});

test("A failed read says so — it never renders as an empty (clean) change set", async ({
	page,
}) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	const worktree = worktreeDir();
	writeFileSync(join(worktree, "README.md"), "# sample-project\n\nedited by e2e\n");
	gitIn(worktree, "branch", "doomed");

	await page.getByTestId("tab-changes").click();
	// Measure against a branch, then delete it out from under the workspace: the host's `git diff` now fails,
	// and a failed diff must not read as "no changes" — that is a claim about the worktree that this read never
	// made, and a review surface calling a dirty worktree clean is the worst thing it can do.
	await page.getByTestId("changes-target-picker").click();
	await page.locator('[data-testid="branch-option"][data-branch="doomed"]').click();
	await expect(page.getByTestId("change-item").filter({ hasText: "README.md" })).toHaveCount(1);
	gitIn(worktree, "branch", "-D", "doomed");

	// A scope switch clears the list, so the next read has nothing to keep: exactly the "never answered vs
	// answered empty" fork. Uncommitted still reads (it measures against HEAD); All changes cannot.
	await page.getByTestId("changes-scope-trigger").click();
	await page.getByTestId("changes-scope-uncommitted").click();
	await expect(page.getByTestId("change-item")).toHaveCount(1);
	await page.getByTestId("changes-scope-trigger").click();
	await page.getByTestId("changes-scope-all").click();

	await expect(page.getByTestId("changes-error")).toBeVisible();
	await expect(page.getByTestId("changes-empty")).toHaveCount(0);
	await expect(page.getByTestId("changes-retry")).toBeVisible();

	// Re-pointing at a ref that exists recovers, so the failure state is a state and not a dead end.
	await page.getByTestId("changes-target-picker").click();
	await page.locator('[data-testid="branch-option"][data-branch="main"]').first().click();
	await expect(page.getByTestId("change-item").filter({ hasText: "README.md" })).toHaveCount(1);
	await expect(page.getByTestId("changes-error")).toHaveCount(0);
});

test("Closing a diff tab disposes Monaco cleanly — no 'TextModel got disposed' assertion", async ({
	page,
}) => {
	// `@monaco-editor/react`'s DiffEditor unmount used to dispose the two TextModels *before* the diff
	// widget, tripping Monaco 0.52+'s "TextModel got disposed before DiffEditorWidget model got reset"
	// assertion (surfaces via Monaco's onUnexpectedError as an uncaught error / console.error). `MonacoDiff`
	// keeps the models and frees them itself after the widget is gone; this pins that closing a diff tab
	// (the unmount) stays silent.
	const monacoErrors: string[] = [];
	const record = (text: string) => {
		if (/TextModel got disposed before DiffEditorWidget/.test(text)) monacoErrors.push(text);
	};
	page.on("pageerror", (err) => record(err.message));
	page.on("console", (msg) => {
		if (msg.type() === "error") record(msg.text());
	});

	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	const worktree = worktreeDir();
	writeFileSync(join(worktree, "script.ts"), "export const edited = true;\n");

	await page.getByTestId("tab-changes").click();
	await page.getByTestId("change-item").filter({ hasText: "script.ts" }).click();
	const diffTab = page.locator('[data-testid="editor-tab"][data-kind="diff"]');
	await expect(diffTab).toHaveCount(1);
	await expect(page.getByTestId("diff-pane")).toContainText("edited = true");

	// Close the diff tab → DiffEditor unmounts. The old disposal order would fire the assertion here.
	await diffTab.getByTestId("editor-tab-close").click();
	await expect(diffTab).toHaveCount(0);
	// Give any deferred (setTimeout-rethrown) unexpected-error a turn to surface before asserting.
	await page.waitForTimeout(100);
	expect(monacoErrors).toEqual([]);
});
