import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Locator, test } from "@playwright/test";
import { createWorkspaceViaDialog, openFixtureProject, worktreeRows } from "./fixtures/app";
import { E2E_DATA_DIR } from "./fixtures/paths";
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

	// A fresh second workspace has its own (empty) change set.
	await createWorkspaceViaDialog(page);
	await expect(worktreeRows(page)).toHaveCount(2);
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

	// A changed file inside a subfolder, so the tree has a folder row to group under.
	const worktree = join(E2E_DATA_DIR, "worktrees", "sample-project", "workspace-1");
	mkdirSync(join(worktree, "docs"), { recursive: true });
	writeFileSync(join(worktree, "docs", "notes.md"), "one\ntwo\nthree\n");

	await page.getByTestId("tab-changes").click();
	// List is the default view.
	await expect(page.getByTestId("changes-toggle-list")).toHaveAttribute("data-active", "true");
	await expect(page.getByTestId("change-item").filter({ hasText: "docs/notes.md" })).toBeVisible();

	// Switch to the folder tree.
	await page.getByTestId("changes-toggle-tree").click();
	await expect(page.getByTestId("changes-toggle-tree")).toHaveAttribute("data-active", "true");

	// A `docs` folder row (default-expanded) and the file node beneath it, with a +count badge.
	await expect(page.getByTestId("change-tree-folder").filter({ hasText: "docs" })).toBeVisible();
	const fileNode = page.getByTestId("change-node").filter({ hasText: "notes.md" });
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

	// The scope is part of a diff tab's identity: the same file in two scopes opens TWO tabs (a tab's
	// content must never change meaning because the rail's scope flipped underneath it).
	await readme.click();
	const diffTabs = page.locator('[data-testid="editor-tab"][data-kind="diff"]');
	await expect(diffTabs).toHaveCount(1);
	await page.getByTestId("changes-scope-trigger").click();
	await page.getByTestId("changes-scope-all").click();
	await expect(page.getByTestId("changes-scope-label")).toHaveText("All changes");
	await page.getByTestId("change-item").filter({ hasText: "README.md" }).click();
	await expect(diffTabs).toHaveCount(2);
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

	await page.getByTestId("tab-changes").click();
	const longRow = page.getByTestId("change-item").filter({ hasText: "diffScopeResolver" }).first();
	await expect(longRow).toBeVisible();
	const rootRow = page.getByTestId("change-item").filter({ hasText: "AtRootLevel" });
	await expect(rootRow).toBeVisible();

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

	// The whole row is the highlight surface (it has to span the trailing `⌄` slot, or a selected row reads
	// as cut off before its own menu) — so the *wrapper* carries the selected state, not the inner button.
	await longRow.click();
	const activeWrapper = page.locator('[data-testid="change-row"][data-active="true"]');
	await expect(activeWrapper).toHaveCount(1);
	const activeBox = (await activeWrapper.boundingBox()) ?? { width: 0 };
	expect(activeBox.width).toBeGreaterThanOrEqual(rowBox.width - 1);

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

test("Re-pointing the target branch re-reads an open branch-scope diff tab at once", async ({
	page,
}) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	const worktree = seedCommitAndDirtyEdit();

	await page.getByTestId("tab-changes").click();
	// A file changed by the branch's commit — visible in the default (vs base) scope, and its diff shows the
	// committed content as an addition.
	await page.getByTestId("change-item").filter({ hasText: "committed.txt" }).click();
	await expect(page.getByTestId("diff-pane")).toContainText("committed by e2e");

	// Re-point the target at the workspace's own branch: that commit is now common ground, so the file's two
	// sides become identical. The OPEN tab must follow the new target immediately — a branch-scope tab means
	// "this file vs the workspace's current target", it does not wait for the next fs tick.
	writeFileSync(join(worktree, "committed.txt"), "committed by e2e\nplus an uncommitted line\n");
	await page.getByTestId("changes-target-picker").click();
	await page.locator('[data-testid="branch-option"][data-branch="workspace-1"]').click();
	await expect(page.getByTestId("diff-pane")).toContainText("plus an uncommitted line");
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
