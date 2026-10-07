import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Locator, type Page, test } from "@playwright/test";
import { createWorkspaceViaDialog, openFixtureProject, worktreeRows } from "./fixtures/app";
import { commitFile, gitQuiet } from "./fixtures/git";
import { E2E_DATA_DIR, E2E_FIXTURE_REPO } from "./fixtures/paths";
import { pierreCollapsedContext, pierreLines } from "./fixtures/pierre";
import { largeRepetitiveMarkdownEdited } from "./fixtures/repo";

const diffText = (page: Page, text: string) =>
	page.getByTestId("diff-view").getByText(text, { exact: false }).last();

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
	const renderedDiff = page.getByTestId("rendered-diff");
	await expect(renderedDiff).toContainText("edited by e2e");

	await expect(page.getByTestId("view-toggle-markdown")).toHaveAttribute("data-active", "true");
	await expect(page.getByTestId("diff-toggle-split")).toHaveCount(0);
	await expect(renderedDiff.locator("h1")).toHaveText("sample-project");
	await expect(renderedDiff.locator("ins")).toContainText("edited by e2e");

	await page.getByTestId("view-toggle-code").click();
	await expect(page.getByTestId("view-toggle-code")).toHaveAttribute("data-active", "true");
	await expect(renderedDiff).toHaveCount(0);

	await changed.click();
	await expect(diffTab).toHaveCount(1);

	writeFileSync(join(worktree, "script.ts"), "export const edited = true;\n");
	await page.getByTestId("change-item").filter({ hasText: "script.ts" }).click();
	await expect(diffText(page, "edited = true")).toBeVisible();
	await expect(page.getByTestId("diff-toggle-split")).toHaveAttribute("data-active", "true");
	await expect(page.getByTestId("view-toggle-markdown")).toHaveCount(0);
	await page.getByTestId("diff-toggle-inline").click();
	await expect(page.getByTestId("diff-toggle-inline")).toHaveAttribute("data-active", "true");
	await expect(diffText(page, "edited = true")).toBeVisible();

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

	// Markdown diffs render by default, so the htmldiff merge kicks off on open:
	// install the long-task observer before opening the diff to measure it.
	await page.evaluate(() => {
		const w = window as unknown as { __maxLongTask: number };
		w.__maxLongTask = 0;
		new PerformanceObserver((list) => {
			for (const entry of list.getEntries())
				w.__maxLongTask = Math.max(w.__maxLongTask, entry.duration);
		}).observe({ type: "longtask" });
	});

	await page.getByTestId("change-item").filter({ hasText: "LARGE.md" }).click();
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

	// Rendered is the default view, so abort the merge worker before opening the diff.
	await page.route(/htmldiff\.worker/, (route) => route.abort());
	await page.getByTestId("tab-changes").click();
	await page.getByTestId("change-item").filter({ hasText: "README.md" }).click();
	await expect(page.getByTestId("rendered-diff-error")).toBeVisible();
	await expect(page.getByTestId("rendered-diff-error")).toContainText("Source");

	await page.getByTestId("view-toggle-code").click();
	await expect(diffText(page, "edited by e2e")).toBeVisible();
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
	const renderedDiff = page.getByTestId("rendered-diff");
	await expect(renderedDiff.locator("ins").filter({ hasText: "first edit by e2e" })).toBeVisible();

	writeFileSync(join(worktree, "README.md"), "# sample-project\n\nsecond edit by e2e\n");
	await expect(renderedDiff.locator("ins").filter({ hasText: "second edit by e2e" })).toBeVisible();
	await expect(renderedDiff).not.toContainText("first edit by e2e");
});

const focusMarkdown = (edited: boolean) => {
	const sections = Array.from({ length: 8 }, (_, index) =>
		[
			`## Section ${index}`,
			"",
			`Paragraph ${index} ${edited && index === 3 ? "revised" : "original"} wording.`,
			"",
			...(index === 3
				? ["<details open><summary>More</summary>", "", "Folded body.", "", "</details>", ""]
				: []),
			`Second paragraph ${index}.`,
		].join("\n"),
	);
	const bullets = Array.from(
		{ length: 12 },
		(_, index) => `- bullet ${index}${edited && index === 6 ? " edited" : ""}`,
	);
	return `# Focus doc\n\nIntro paragraph.\n\n${sections.join("\n\n")}\n\n## Checklist\n\n${bullets.join("\n")}\n`;
};

test("Rendered markdown diff collapses unchanged blocks and list items around the changes", async ({
	page,
}) => {
	await openFixtureProject(page);
	const workspace = await createWorkspaceViaDialog(page);
	commitFile(workspace.worktreePath, "FOCUS.md", focusMarkdown(false), "add focus fixture");
	writeFileSync(join(workspace.worktreePath, "FOCUS.md"), focusMarkdown(true));

	await page.getByTestId("tab-changes").click();
	await page.getByTestId("changes-scope-trigger").click();
	await page.getByTestId("changes-scope-uncommitted").click();
	await page.getByTestId("change-item").filter({ hasText: "FOCUS.md" }).click();
	const renderedDiff = page.getByTestId("rendered-diff");
	await expect(renderedDiff.locator("ins").filter({ hasText: "revised" })).toBeVisible();
	await expect(page.getByTestId("rendered-diff-empty")).toHaveCount(0);

	const collapsed = renderedDiff.getByTestId("rendered-diff-collapsed");
	await expect(collapsed).toHaveCount(4);
	await expect(collapsed.nth(0)).toContainText("10 unchanged blocks");
	await expect(collapsed.nth(0)).toContainText("§ Section 2");
	await expect(collapsed.nth(1)).toContainText("11 unchanged blocks");
	await expect(collapsed.nth(1)).toContainText("§ Section 7");
	await expect(collapsed.nth(2)).toContainText("4 unchanged items");
	await expect(collapsed.nth(3)).toContainText("3 unchanged items");

	await expect(renderedDiff).toContainText("Second paragraph 2.");
	await expect(renderedDiff.locator("h2", { hasText: "Section 3" })).toBeVisible();
	await expect(renderedDiff.locator("details[open]")).toContainText("Folded body.");
	await expect(renderedDiff).toContainText("Second paragraph 3.");
	await expect(renderedDiff).not.toContainText("Focus doc");
	await expect(renderedDiff).not.toContainText("Paragraph 0 ");
	await expect(renderedDiff).not.toContainText("Section 4");
	await expect(renderedDiff.locator("li", { hasText: "bullet 4" })).toBeVisible();
	await expect(renderedDiff.locator("li", { hasText: "bullet 8" })).toBeVisible();
	await expect(renderedDiff).not.toContainText("bullet 0");
	await expect(renderedDiff).not.toContainText("bullet 11");

	await collapsed.nth(0).click();
	await expect(renderedDiff.locator("h1")).toHaveText("Focus doc");
	await expect(renderedDiff).toContainText("Paragraph 0 original wording.");
	await expect(collapsed).toHaveCount(3);

	await collapsed.filter({ hasText: "3 unchanged items" }).click();
	await expect(renderedDiff.locator("li", { hasText: "bullet 11" })).toBeVisible();
	await expect(collapsed).toHaveCount(2);
});

test("Rendered markdown diff of a front-matter-only change says the preview is identical", async ({
	page,
}) => {
	await openFixtureProject(page);
	const workspace = await createWorkspaceViaDialog(page);
	const doc = (status: string) =>
		`---\nstatus: ${status}\n---\n\n# Front matter doc\n\nBody paragraph.\n`;
	commitFile(workspace.worktreePath, "META.md", doc("draft"), "add front matter fixture");
	writeFileSync(join(workspace.worktreePath, "META.md"), doc("active"));

	await page.getByTestId("tab-changes").click();
	await page.getByTestId("changes-scope-trigger").click();
	await page.getByTestId("changes-scope-uncommitted").click();
	await page.getByTestId("change-item").filter({ hasText: "META.md" }).click();
	const renderedDiff = page.getByTestId("rendered-diff");
	await expect(page.getByTestId("rendered-diff-empty")).toContainText("Source");
	const collapsed = renderedDiff.getByTestId("rendered-diff-collapsed");
	await expect(collapsed).toHaveCount(1);
	await expect(collapsed).toContainText("2 unchanged blocks");
	await expect(renderedDiff).not.toContainText("Body paragraph.");

	await collapsed.click();
	await expect(renderedDiff).toContainText("Body paragraph.");
	await expect(renderedDiff.locator("ins, del")).toHaveCount(0);

	await page.getByTestId("view-toggle-code").click();
	await expect(diffText(page, "active")).toBeVisible();
});

test("Rendered markdown diff keeps attribute-only changes visible: a ticked task, an opened details, a list numbered by HTML's integer rules", async ({
	page,
}) => {
	await openFixtureProject(page);
	const workspace = await createWorkspaceViaDialog(page);
	const doc = (edited: boolean) =>
		[
			"# Attribute doc",
			"",
			"## Tasks",
			"",
			...Array.from(
				{ length: 10 },
				(_, index) => `- [${edited && index === 5 ? "x" : " "}] task ${index}`,
			),
			"",
			"## Numbered",
			"",
			'<ol start="">',
			"<li>one</li>",
			'<li value="10">ten</li>',
			'<li value="">eleven</li>',
			`<li>twelve${edited ? " edited" : ""}</li>`,
			"</ol>",
			"",
			`<details${edited ? " open" : ""}><summary>More</summary>`,
			"",
			"Folded body.",
			"",
			"</details>",
			"",
			`<input type="checkbox"${edited ? " checked" : ""}>`,
			"",
		].join("\n");
	commitFile(workspace.worktreePath, "ATTR.md", doc(false), "add attribute fixture");
	writeFileSync(join(workspace.worktreePath, "ATTR.md"), doc(true));

	await page.getByTestId("tab-changes").click();
	await page.getByTestId("changes-scope-trigger").click();
	await page.getByTestId("changes-scope-uncommitted").click();
	await page.getByTestId("change-item").filter({ hasText: "ATTR.md" }).click();
	const renderedDiff = page.getByTestId("rendered-diff");
	await expect(renderedDiff.locator("ins").filter({ hasText: "edited" })).toBeVisible();
	await expect(page.getByTestId("rendered-diff-empty")).toHaveCount(0);

	const ticked = renderedDiff.locator("li", { hasText: "task 5" });
	await expect(ticked.locator("input[type=checkbox]")).toBeChecked();
	await expect(renderedDiff.locator("li", { hasText: "task 3" })).toBeVisible();
	await expect(renderedDiff).not.toContainText("task 0");
	await expect(renderedDiff).not.toContainText("task 9");
	const collapsed = renderedDiff.getByTestId("rendered-diff-collapsed");
	await expect(collapsed).toHaveCount(2);
	await expect(collapsed.nth(0)).toContainText("3 unchanged items");
	await expect(collapsed.nth(1)).toContainText("2 unchanged items");

	await expect(renderedDiff.locator("details[open]")).toContainText("Folded body.");
	await expect(renderedDiff.locator("li", { hasText: "one" })).toHaveAttribute("value", "1");
	await expect(renderedDiff.locator("li", { hasText: "ten" })).toHaveAttribute("value", "10");
	await expect(renderedDiff.locator("li", { hasText: "eleven" })).toHaveAttribute("value", "11");
	await expect(renderedDiff.locator("li", { hasText: "twelve" })).toHaveAttribute("value", "12");
	const standalone = renderedDiff.locator("details + input[type=checkbox]");
	await expect(standalone).toBeChecked();
	await expect(standalone).toBeDisabled();
});

test("Rendered markdown diff aligns identical twin blocks by position, so neither a vouching twin nor a swap hides an attribute-only change", async ({
	page,
}) => {
	await openFixtureProject(page);
	const workspace = await createWorkspaceViaDialog(page);
	const twin = (open: boolean) =>
		[
			`<details${open ? " open" : ""}><summary>Twin</summary>`,
			"",
			"Twin body.",
			"",
			"</details>",
		].join("\n");
	const doc = (first: boolean, second: boolean) =>
		`# Twins\n\n${twin(first)}\n\n${twin(second)}\n\nTail paragraph.\n`;
	commitFile(workspace.worktreePath, "VOUCH.md", doc(true, false), "add vouch fixture");
	writeFileSync(join(workspace.worktreePath, "VOUCH.md"), doc(true, true));
	commitFile(workspace.worktreePath, "SWAP.md", doc(true, false), "add swap fixture");
	writeFileSync(join(workspace.worktreePath, "SWAP.md"), doc(false, true));

	await page.getByTestId("tab-changes").click();
	await page.getByTestId("changes-scope-trigger").click();
	await page.getByTestId("changes-scope-uncommitted").click();
	const renderedDiff = page.getByTestId("rendered-diff");

	await page.getByTestId("change-item").filter({ hasText: "VOUCH.md" }).click();
	await expect(renderedDiff.locator("details[open]")).toHaveCount(2);
	await expect(page.getByTestId("rendered-diff-empty")).toHaveCount(0);
	await expect(renderedDiff.getByTestId("rendered-diff-collapsed")).toHaveCount(0);

	await page.getByTestId("change-item").filter({ hasText: "SWAP.md" }).click();
	await expect(renderedDiff.locator("details")).toHaveCount(2);
	await expect(renderedDiff.locator("details[open]")).toHaveCount(1);
	await expect(renderedDiff.locator("details").first()).not.toHaveAttribute("open");
	await expect(page.getByTestId("rendered-diff-empty")).toHaveCount(0);
	await expect(renderedDiff.getByTestId("rendered-diff-collapsed")).toHaveCount(0);
	await expect(renderedDiff).toContainText("Tail paragraph.");
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
	await expect(page.getByTestId("rendered-diff")).toContainText("three");

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

function seedMutableHunks(): { path: string; base: string; modified: string } {
	const path = join(worktreeDir(), "mutable.ts");
	const base = [
		"export const one = 1;",
		"export const two = 2;",
		"export const three = 3;",
		"export const four = 4;",
		"export const five = 5;",
		"export const six = 6;",
		"",
	].join("\n");
	writeFileSync(path, base);
	gitQuiet(worktreeDir(), "add", "mutable.ts");
	gitQuiet(
		worktreeDir(),
		"-c",
		"user.email=e2e@thinkrail.test",
		"-c",
		"user.name=ThinkRail E2E",
		"commit",
		"-m",
		"mutable hunk fixture",
	);
	const modified = base.replace("two = 2", "two = 200").replace("five = 5", "five = 500");
	writeFileSync(path, modified);
	return { path, base, modified };
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
	const dirtyLineCount = () =>
		pierreLines(page.getByTestId("diff-view"), "dirty line by e2e").count();
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
	await expect(page.getByTestId("diff-empty")).toBeVisible({ timeout: 10_000 });
	await expect.poll(dirtyLineCount).toBe(0);
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
	await expect(page.getByTestId("rendered-diff")).toContainText("two");

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
	const diff = page.getByTestId("diff-view");
	await expect(pierreCollapsedContext(diff).first()).toHaveText(/\d+ unmodified lines/);
	await expect(diff.getByText("6000", { exact: false }).last()).toBeVisible();

	const whitespace = page.getByTestId("diff-toggle-whitespace");
	await expect(whitespace).toHaveAttribute("data-active", "false");
	await whitespace.click();
	await expect(whitespace).toHaveAttribute("data-active", "true");

	await page.getByTestId("diff-copy").click();
	expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(
		"export const v60 = 6000;",
	);
});

test("revert hunk changes only that range and Undo restores it", async ({ page }) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	const fixture = seedMutableHunks();

	await page.getByTestId("tab-changes").click();
	await page.getByTestId("changes-scope-trigger").click();
	await page.getByTestId("changes-scope-uncommitted").click();
	await page.getByTestId("change-item").filter({ hasText: "mutable.ts" }).click();
	await expect(diffText(page, "two = 200")).toBeVisible();
	await expect(page.getByTestId("hunk-revert")).toHaveCount(2);
	await expect(page.getByTestId("hunk-ask-agent")).toHaveCount(2);
	await expect(page.getByTestId("diff-revert-file")).toBeVisible();
	await page.getByTestId("hunk-ask-agent").first().click();
	await expect(page.getByTestId("review-composer-input")).toHaveValue(
		"Please revise this change: ",
	);
	await page.getByTestId("review-composer-cancel").click();

	await page.getByTestId("hunk-revert").first().click();
	await expect(
		page.getByTestId("toast").filter({ hasText: "Reverted hunk in mutable.ts" }),
	).toBeVisible();
	await expect
		.poll(() => readFileSync(fixture.path, "utf8").split("\n")[1])
		.toBe(fixture.base.split("\n")[1]);
	expect(readFileSync(fixture.path, "utf8")).toContain("five = 500");

	await page.getByTestId("toast-action").click();
	await expect.poll(() => readFileSync(fixture.path, "utf8")).toBe(fixture.modified);
});

test("a stale hunk view refreshes instead of overwriting the newer file", async ({ page }) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	const fixture = seedMutableHunks();

	await page.getByTestId("tab-changes").click();
	await page.getByTestId("changes-scope-trigger").click();
	await page.getByTestId("changes-scope-uncommitted").click();
	await page.getByTestId("change-item").filter({ hasText: "mutable.ts" }).click();
	await expect(diffText(page, "two = 200")).toBeVisible();
	const revert = page.getByTestId("hunk-revert").first();
	const revertBox = await revert.boundingBox();
	if (!revertBox) throw new Error("Hunk revert button has no box");

	const newer = fixture.modified.replace("two = 200", "two = 201");
	writeFileSync(fixture.path, newer);
	await page.mouse.click(revertBox.x + revertBox.width / 2, revertBox.y + revertBox.height / 2);
	await expect(
		page
			.getByTestId("toast")
			.filter({ hasText: "This file changed since you opened it — review the new diff" }),
	).toBeVisible();
	await expect(diffText(page, "two = 201")).toBeVisible();
	expect(readFileSync(fixture.path, "utf8")).toBe(newer);
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
	await expect(page.getByTestId("diff-view")).toBeVisible();

	await page.setViewportSize({ width: 620, height: 800 });
	await expect(page.getByTestId("diff-toggle-split")).toHaveCount(0);
	await expect(page.getByTestId("diff-toggle-inline")).toHaveCount(0);
	await expect(page.getByTestId("diff-toggle-whitespace")).toBeVisible();
	await expect(page.getByTestId("diff-copy")).toBeVisible();
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
	const sourceDiff = page.getByTestId("diff-view");
	await expect(
		sourceDiff.getByText("revised by the workspace", { exact: false }).last(),
	).toBeVisible();
	await expect(sourceDiff.getByText("committed by e2e", { exact: false })).toHaveCount(0);

	await page.getByTestId("changes-target-picker").click();
	await page.locator('[data-testid="branch-option"][data-branch="e2e-target"]').click();
	await expect(sourceDiff.getByText("committed by e2e", { exact: false }).last()).toBeVisible();

	const readmeTab = page.getByTestId("change-item").filter({ hasText: "README.md" });
	await readmeTab.click();
	await expect(page.getByTestId("rendered-diff")).toContainText("dirty edit by e2e");
	await page.getByTestId("changes-target-picker").click();
	await page.locator('[data-testid="branch-option"][data-branch="main"]').first().click();

	await committedRow.click();
	await expect(
		sourceDiff.getByText("revised by the workspace", { exact: false }).last(),
	).toBeVisible();
	await expect(sourceDiff.getByText("committed by e2e", { exact: false })).toHaveCount(0);
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

test("A source diff keeps its scroll position across a tab switch", async ({ page }) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	const worktree = worktreeDir();
	const source = (version: string) =>
		`${Array.from({ length: 400 }, (_, index) =>
			index % 7 === 0
				? `export const v${index} = "${version} ${index}";`
				: `export const c${index} = ${index};`,
		).join("\n")}\n`;
	commitFile(worktree, "scroll-code.ts", source("base"), "add scroll fixture");
	writeFileSync(join(worktree, "scroll-code.ts"), source("edited"));

	await page.getByTestId("tab-changes").click();
	await page.getByTestId("change-item").filter({ hasText: "scroll-code.ts" }).click();
	const diff = page.getByTestId("diff-view");
	await expect(diffText(page, "edited 399")).toBeVisible();
	const top = await diff.evaluate((node) => {
		node.scrollTop = (node.scrollHeight - node.clientHeight) * 0.6;
		return node.scrollTop;
	});
	expect(top).toBeGreaterThan(1_000);

	await page.locator('[data-testid="editor-tab"][data-kind="chat"]').click();
	await expect(diff).toHaveCount(0);
	await page.locator('[data-testid="editor-tab"][data-kind="diff"]').click();
	await expect(diffText(page, "edited 399")).toBeVisible();
	await expect.poll(() => diff.evaluate((node) => node.scrollTop)).toBe(top);
});

test("Closing a diff tab removes its Pierre surface", async ({ page }) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	const worktree = worktreeDir();
	writeFileSync(join(worktree, "script.ts"), "export const edited = true;\n");

	await page.getByTestId("tab-changes").click();
	await page.getByTestId("change-item").filter({ hasText: "script.ts" }).click();
	const diffTab = page.locator('[data-testid="editor-tab"][data-kind="diff"]');
	await expect(diffTab).toHaveCount(1);
	await expect(diffText(page, "edited = true")).toBeVisible();

	await diffTab.getByTestId("editor-tab-close").click();
	await expect(diffTab).toHaveCount(0);
	await expect(page.getByTestId("diff-view")).toHaveCount(0);
});
