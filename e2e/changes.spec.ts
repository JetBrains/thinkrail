import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Locator, test } from "@playwright/test";
import { createWorkspaceViaDialog, openFixtureProject, worktreeRows } from "./fixtures/app";
import { gitQuiet } from "./fixtures/git";
import { E2E_DATA_DIR, E2E_FIXTURE_REPO } from "./fixtures/paths";
import { largeRepetitiveMarkdownEdited } from "./fixtures/repo";

test("Changes tab shows the active worktree's diff and swaps per workspace", async ({ page }) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	await expect(worktreeRows(page)).toHaveCount(1);

	const worktree = join(E2E_DATA_DIR, "worktrees", "sample-project", "workspace-1");
	writeFileSync(join(worktree, "README.md"), "# sample-project\n\nedited by e2e\n");

	await page.getByTestId("tab-changes").click();
	const changed = page.getByTestId("change-item").filter({ hasText: "README.md" });
	await expect(changed).toHaveAttribute("data-status", "modified");

	await changed.click();
	const diffTab = page.locator('[data-testid="editor-tab"][data-kind="diff"]');
	await expect(diffTab).toHaveCount(1);
	await expect(diffTab).toHaveAttribute("data-active", "true");
	await expect(page.getByTestId("diff-pane")).toContainText("edited by e2e");

	await expect(page.getByTestId("diff-toggle-source")).toHaveAttribute("data-active", "true");
	await expect(page.getByTestId("diff-toggle-split")).toHaveCount(0);
	await page.getByTestId("diff-toggle-rendered").click();
	await expect(page.getByTestId("diff-toggle-rendered")).toHaveAttribute("data-active", "true");
	const renderedDiff = page.getByTestId("rendered-diff");
	await expect(renderedDiff.locator("h1")).toHaveText("sample-project");
	await expect(renderedDiff.locator("ins")).toContainText("edited by e2e");

	await page.getByTestId("diff-toggle-source").click();
	await expect(page.getByTestId("diff-toggle-source")).toHaveAttribute("data-active", "true");
	await expect(renderedDiff).toHaveCount(0);

	await changed.click();
	await expect(diffTab).toHaveCount(1);

	writeFileSync(join(worktree, "script.ts"), "export const edited = true;\n");
	await page.getByTestId("change-item").filter({ hasText: "script.ts" }).click();
	await expect(page.getByTestId("diff-pane")).toContainText("edited = true");
	await expect(page.getByTestId("diff-toggle-split")).toHaveAttribute("data-active", "true");
	await expect(page.getByTestId("diff-toggle-rendered")).toHaveCount(0);
	await page.getByTestId("diff-toggle-inline").click();
	await expect(page.getByTestId("diff-toggle-inline")).toHaveAttribute("data-active", "true");
	await expect(page.getByTestId("diff-pane")).toContainText("edited = true");

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

	const worktree = join(E2E_DATA_DIR, "worktrees", "sample-project", "workspace-1");
	writeFileSync(join(worktree, "LARGE.md"), largeRepetitiveMarkdownEdited());

	await page.getByTestId("tab-changes").click();
	await page.getByTestId("change-item").filter({ hasText: "LARGE.md" }).click();
	await expect(page.getByTestId("diff-pane")).toBeVisible();

	await page.evaluate(() => {
		const w = window as unknown as { __maxLongTask: number };
		w.__maxLongTask = 0;
		new PerformanceObserver((list) => {
			for (const entry of list.getEntries())
				w.__maxLongTask = Math.max(w.__maxLongTask, entry.duration);
		}).observe({ type: "longtask" });
	});

	await page.getByTestId("diff-toggle-rendered").click();
	await expect(page.getByTestId("rendered-diff-loading")).toBeVisible();
	const renderedDiff = page.getByTestId("rendered-diff");
	await expect(renderedDiff.locator("ins").filter({ hasText: "EDITED" }).first()).toBeVisible({
		timeout: 60_000,
	});
	await expect(renderedDiff.locator("del").filter({ hasText: "alpha" }).first()).toBeVisible();

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

	await page.route(/htmldiff\.worker/, (route) => route.abort());
	await page.getByTestId("diff-toggle-rendered").click();
	await expect(page.getByTestId("rendered-diff-error")).toBeVisible();
	await expect(page.getByTestId("rendered-diff-error")).toContainText("Source");

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

	writeFileSync(join(worktree, "README.md"), "# sample-project\n\nsecond edit by e2e\n");
	await expect(renderedDiff.locator("ins").filter({ hasText: "second edit by e2e" })).toBeVisible();
	await expect(renderedDiff).not.toContainText("first edit by e2e");
});

test("Changes has a List|Tree toggle; Tree groups files into folders with +/- counts", async ({
	page,
}) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);

	const worktree = join(E2E_DATA_DIR, "worktrees", "sample-project", "workspace-1");
	mkdirSync(join(worktree, "docs", "guides"), { recursive: true });
	writeFileSync(join(worktree, "docs", "guides", "notes.md"), "one\ntwo\nthree\n");

	await page.getByTestId("tab-changes").click();
	await expect(page.getByTestId("changes-toggle-list")).toHaveAttribute("data-active", "true");
	await expect(
		page.getByTestId("change-item").filter({ hasText: "docs/guides/notes.md" }),
	).toBeVisible();

	await page.getByTestId("changes-toggle-tree").click();
	await expect(page.getByTestId("changes-toggle-tree")).toHaveAttribute("data-active", "true");

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

	await fileNode.click();
	const diffTab = page.locator('[data-testid="editor-tab"][data-kind="diff"]');
	await expect(diffTab).toHaveCount(1);
	await expect(page.getByTestId("diff-pane")).toContainText("three");

	await page.getByTestId("tab-files").click();
	await page.getByTestId("tab-changes").click();
	await expect(page.getByTestId("changes-toggle-tree")).toHaveAttribute("data-active", "true");
});

function worktreeDir(): string {
	return join(E2E_DATA_DIR, "worktrees", "sample-project", "workspace-1");
}

function seedCommitAndDirtyEdit(): string {
	const worktree = worktreeDir();
	writeFileSync(join(worktree, "committed.txt"), "committed by e2e\n");
	gitQuiet(worktree, "add", "committed.txt");
	gitQuiet(
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
	await expect(page.getByTestId("changes-scope-label")).toHaveText("All changes");
	await expect(page.getByTestId("change-item")).toHaveCount(2);

	await page.getByTestId("changes-scope-trigger").click();
	const commitRow = page
		.getByTestId("changes-scope-commit")
		.filter({ hasText: "e2e scope commit" });
	await expect(commitRow).toHaveCount(1);
	await commitRow.click();
	await expect(page.getByTestId("changes-scope-label")).toHaveText(/^[0-9a-f]{7,}$/);
	await expect(page.getByTestId("change-item")).toHaveCount(1);
	await expect(page.getByTestId("change-item").first()).toContainText("committed.txt");

	await page.getByTestId("changes-scope-trigger").click();
	await page.getByTestId("changes-scope-uncommitted").click();
	await expect(page.getByTestId("changes-scope-label")).toHaveText("Uncommitted");
	await expect(page.getByTestId("change-item")).toHaveCount(1);
	const readme = page.getByTestId("change-item").filter({ hasText: "README.md" });
	await expect(readme).toHaveCount(1);

	await readme.dblclick();
	const diffTabs = page.locator('[data-testid="editor-tab"][data-kind="diff"]');
	await expect(diffTabs).toHaveCount(1);
	await page.getByTestId("changes-scope-trigger").click();
	await page.getByTestId("changes-scope-all").click();
	await expect(page.getByTestId("changes-scope-label")).toHaveText("All changes");
	await page.getByTestId("change-item").filter({ hasText: "README.md" }).dblclick();
	await expect(diffTabs).toHaveCount(2);
});

test("Uncommitted scope converges when HEAD moves out-of-band (a commit in a terminal)", async ({
	page,
}) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	const worktree = seedCommitAndDirtyEdit();
	writeFileSync(join(worktree, "committed.txt"), "committed by e2e\ndirty line by e2e\n");

	await page.getByTestId("tab-changes").click();
	await page.getByTestId("changes-scope-trigger").click();
	await page.getByTestId("changes-scope-uncommitted").click();
	const dirtyRow = page.getByTestId("change-item").filter({ hasText: "committed.txt" });
	await expect(dirtyRow).toHaveCount(1);

	await dirtyRow.dblclick();
	const dirtyLineCount = async () => {
		const text = ((await page.getByTestId("diff-pane").textContent()) ?? "").replace(/\s+/g, " ");
		return (text.match(/dirty line by e2e/g) ?? []).length;
	};
	await expect.poll(dirtyLineCount, { timeout: 15_000 }).toBe(1);

	await new Promise((r) => setTimeout(r, 1500));

	gitQuiet(worktree, "add", "-A");
	gitQuiet(
		worktree,
		"-c",
		"user.email=e2e@thinkrail.test",
		"-c",
		"user.name=ThinkRail E2E",
		"commit",
		"-m",
		"e2e commits the dirty edits",
	);

	await expect(page.getByTestId("change-item")).toHaveCount(0, { timeout: 10_000 });
	await expect(page.getByTestId("changes-empty")).toBeVisible();
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

	const upstreamWt = join(E2E_DATA_DIR, "worktrees", "e2e-upstream");
	gitQuiet(E2E_FIXTURE_REPO, "worktree", "add", upstreamWt, "-b", "future-main", "main");
	writeFileSync(join(upstreamWt, "upstream.txt"), "landed on the base after the fork\n");
	gitQuiet(upstreamWt, "add", "upstream.txt");
	gitQuiet(
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
	await expect(page.getByTestId("change-item")).toHaveCount(2);

	await page.getByTestId("changes-target-picker").click();
	await page.locator('[data-testid="branch-option"][data-branch="future-main"]').click();
	await expect(page.getByTestId("changes-target-picker")).toContainText("future-main");

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

	const worktree = worktreeDir();
	mkdirSync(join(worktree, "docs"), { recursive: true });
	writeFileSync(join(worktree, "docs", "notes.md"), "one\ntwo\n");

	await page.getByTestId("tab-changes").click();
	const row = page.getByTestId("change-item").filter({ hasText: "docs/notes.md" });
	await expect(row).toBeVisible();

	await row.hover();
	await page.getByTestId("change-row-menu").click();
	await expect(page.getByTestId("change-row-actions")).toBeVisible();
	await page.getByTestId("change-action-copy-path").click();
	expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("docs/notes.md");

	await row.click({ button: "right" });
	await expect(page.getByTestId("change-row-actions")).toBeVisible();
	await page.getByTestId("change-action-view").click();
	await expect(page.locator('[data-testid="editor-tab"][data-kind="diff"]')).toHaveCount(1);
	await expect(page.getByTestId("diff-pane")).toContainText("two");

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

	const worktree = worktreeDir();
	const lines = Array.from({ length: 120 }, (_, i) => `export const v${i} = ${i};`);
	writeFileSync(join(worktree, "long.ts"), `${lines.join("\n")}\n`);
	gitQuiet(worktree, "add", "long.ts");
	gitQuiet(
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
	await page.getByTestId("changes-scope-trigger").click();
	await page.getByTestId("changes-scope-uncommitted").click();
	await page.getByTestId("change-item").filter({ hasText: "long.ts" }).click();
	await expect(page.getByTestId("diff-path")).toHaveText("long.ts");
	await expect(page.getByTestId("diff-pane").locator(".diff-hidden-lines").first()).toHaveText(
		/\d+ hidden lines/,
	);
	await expect(page.getByTestId("diff-pane")).toContainText("6000");

	const whitespace = page.getByTestId("diff-toggle-whitespace");
	await expect(whitespace).toHaveAttribute("data-active", "false");
	await whitespace.click();
	await expect(whitespace).toHaveAttribute("data-active", "true");

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

	const worktree = worktreeDir();
	mkdirSync(join(worktree, "packages/server/src/git"), { recursive: true });
	writeFileSync(
		join(worktree, "packages/server/src/git/diffScopeResolverImplementationForTheChangesPanel.ts"),
		"export const range = 1;\n",
	);
	writeFileSync(join(worktree, "README.md"), "# sample-project\n\nedited by e2e\n");
	writeFileSync(
		join(worktree, "diffScopeResolverImplementationForTheChangesPanelAtRootLevel.ts"),
		"export const root = 1;\n",
	);
	mkdirSync(join(worktree, "packages/server/src/git/deeply/nested/for/the/changes/panel"), {
		recursive: true,
	});
	writeFileSync(
		join(worktree, "packages/server/src/git/deeply/nested/for/the/changes/panel/shortName.ts"),
		"export const short = 1;\n",
	);

	await page.getByTestId("tab-changes").click();
	const longRow = page.getByTestId("change-item").filter({ hasText: "ForTheChangesPanel.ts" });
	await expect(longRow).toHaveCount(1);
	const rootRow = page.getByTestId("change-item").filter({ hasText: "AtRootLevel" });
	await expect(rootRow).toHaveCount(1);

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

	const clipped = (locator: Locator) => locator.evaluate((n) => n.scrollWidth - n.clientWidth);
	const shortNameRow = page.getByTestId("change-item").filter({ hasText: "shortName.ts" });
	await expect(shortNameRow).toHaveCount(1);
	expect(await clipped(shortNameRow.getByTestId("change-path-dir"))).toBeGreaterThan(1);
	expect(await clipped(shortNameRow.getByTestId("change-path-base"))).toBeLessThanOrEqual(1);
	expect(await clipped(longRow.getByTestId("change-path-base"))).toBeGreaterThan(1);
	expect(await clipped(rootRow.getByTestId("change-path-base"))).toBeGreaterThan(1);

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

	await page.getByTestId("changes-toggle-tree").click();
	const folderBadge = page.getByTestId("change-tree-folder").filter({ hasText: "packages" });
	const fileBadge = page.getByTestId("change-node").filter({ hasText: "ForTheChangesPanel.ts" });
	const folderRight = await rightEdge(folderBadge);
	const fileRight = await rightEdge(fileBadge);
	expect(Math.abs(folderRight - fileRight)).toBeLessThanOrEqual(1);
});

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

	await page.setViewportSize({ width: 620, height: 800 });
	await expect(page.getByTestId("diff-toggle-whitespace")).toBeVisible();
	await expect(page.getByTestId("diff-copy")).toBeVisible();
	await expect(page.getByTestId("diff-toggle-split")).toBeVisible();
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

	const label = page.getByTestId("changes-scope-label");
	await expect(label).toHaveText(/^[0-9a-f]{7,}$/);
	await expect(page.getByTestId("changes-scope-trigger")).toHaveAttribute(
		"title",
		/e2e scope commit/,
	);
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
	writeFileSync(join(worktree, "committed.txt"), "revised by the workspace\n");
	gitQuiet(worktree, "add", "committed.txt");
	gitQuiet(
		worktree,
		"-c",
		"user.email=e2e@thinkrail.test",
		"-c",
		"user.name=ThinkRail E2E",
		"commit",
		"-m",
		"e2e revise commit",
	);
	gitQuiet(worktree, "branch", "e2e-target", "HEAD~1");

	await page.getByTestId("tab-changes").click();
	const committedRow = page.getByTestId("change-item").filter({ hasText: "committed.txt" });
	await committedRow.dblclick();
	const diffPane = page.getByTestId("diff-pane");
	await expect(diffPane).toContainText("revised by the workspace");
	await expect(diffPane).not.toContainText("committed by e2e");

	await page.getByTestId("changes-target-picker").click();
	await page.locator('[data-testid="branch-option"][data-branch="e2e-target"]').click();
	await expect(diffPane).toContainText("committed by e2e");

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

	gitQuiet(worktree, "reset", "--hard", "HEAD~1");
	gitQuiet(worktree, "reflog", "expire", "--expire=now", "--all");
	gitQuiet(worktree, "gc", "--prune=now");
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
	gitQuiet(worktree, "branch", "doomed");

	await page.getByTestId("tab-changes").click();
	await page.getByTestId("changes-target-picker").click();
	await page.locator('[data-testid="branch-option"][data-branch="doomed"]').click();
	await expect(page.getByTestId("change-item").filter({ hasText: "README.md" })).toHaveCount(1);
	gitQuiet(worktree, "branch", "-D", "doomed");

	await page.getByTestId("changes-scope-trigger").click();
	await page.getByTestId("changes-scope-uncommitted").click();
	await expect(page.getByTestId("change-item")).toHaveCount(1);
	await page.getByTestId("changes-scope-trigger").click();
	await page.getByTestId("changes-scope-all").click();

	await expect(page.getByTestId("changes-error")).toBeVisible();
	await expect(page.getByTestId("changes-empty")).toHaveCount(0);
	await expect(page.getByTestId("changes-retry")).toBeVisible();

	await page.getByTestId("changes-target-picker").click();
	await page.locator('[data-testid="branch-option"][data-branch="main"]').first().click();
	await expect(page.getByTestId("change-item").filter({ hasText: "README.md" })).toHaveCount(1);
	await expect(page.getByTestId("changes-error")).toHaveCount(0);
});

test("Closing a diff tab disposes Monaco cleanly — no 'TextModel got disposed' assertion", async ({
	page,
}) => {
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

	await diffTab.getByTestId("editor-tab-close").click();
	await expect(diffTab).toHaveCount(0);
	await page.waitForTimeout(100);
	expect(monacoErrors).toEqual([]);
});
