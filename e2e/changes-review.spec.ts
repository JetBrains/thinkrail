import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { createWorkspaceViaDialog, openFixtureProject, revealWorkbenchTool } from "./fixtures/app";
import { E2E_DATA_DIR } from "./fixtures/paths";

const reviewTab = (page: Page) => page.locator('[data-testid="editor-tab"][data-kind="changes"]');
const diffTab = (page: Page) => page.locator('[data-testid="editor-tab"][data-kind="diff"]');
const sections = (page: Page) => page.getByTestId("changes-section");
const section = (page: Page, path: string) =>
	page.locator(`[data-testid="changes-section"][data-path="${path}"]`);
const row = (page: Page, name: string) => page.getByTestId("change-item").filter({ hasText: name });

async function seedThreeChanges(page: Page): Promise<string> {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	const worktree = join(E2E_DATA_DIR, "worktrees", "sample-project", "workspace-1");
	writeFileSync(join(worktree, "README.md"), "# sample-project\n\nedited by e2e\n");
	writeFileSync(join(worktree, "script.ts"), "export const edited = true;\n");
	writeFileSync(join(worktree, "notes.txt"), "a note edited by e2e\n");
	await revealWorkbenchTool(page, "changes");
	await expect(row(page, "notes.txt")).toBeVisible();
	return worktree;
}

test("a single click opens one continuous review tab in preview with a section per changed file", async ({
	page,
}) => {
	await seedThreeChanges(page);

	await row(page, "script.ts").click();
	await expect(reviewTab(page)).toHaveCount(1);
	await expect(reviewTab(page)).toHaveAttribute("data-preview", "true");
	await expect(diffTab(page)).toHaveCount(0);
	await expect(page.getByTestId("changes-review-summary")).toContainText("3 files");
	await expect(sections(page)).toHaveCount(3);
	await expect(page.getByTestId("changes-review-viewed-count")).toHaveText("0/3 viewed");

	// each section dispatches the registry renderer the per-file tab would use
	await expect(section(page, "README.md").getByTestId("rendered-diff")).toContainText(
		"edited by e2e",
	);
	await expect(section(page, "README.md").getByTestId("view-toggle-markdown")).toHaveAttribute(
		"data-active",
		"true",
	);
	await expect(
		section(page, "script.ts").getByTestId("diff-view").getByText("edited = true").last(),
	).toBeVisible();

	// the clicked file is the active one in the navigator; another click reveals another section
	await expect(row(page, "script.ts")).toHaveAttribute("data-active", "true");
	await row(page, "notes.txt").click();
	await expect(reviewTab(page)).toHaveCount(1);
	await expect(row(page, "notes.txt")).toHaveAttribute("data-active", "true");

	// viewed state is shared by the section header and the sidebar row
	await section(page, "script.ts").getByTestId("changes-section-viewed").click();
	await expect(page.getByTestId("changes-review-viewed-count")).toHaveText("1/3 viewed");
	await expect(row(page, "script.ts")).toHaveAttribute("data-viewed", "true");
	await expect(section(page, "script.ts")).toHaveAttribute("data-viewed", "true");

	// collapse / expand all
	await page.getByTestId("changes-review-collapse-all").click();
	await expect(page.locator('[data-testid="changes-section"][data-collapsed="true"]')).toHaveCount(
		3,
	);
	await expect(section(page, "README.md").getByTestId("rendered-diff")).toHaveCount(0);
	await page.getByTestId("changes-review-expand-all").click();
	await expect(page.locator('[data-testid="changes-section"][data-collapsed="true"]')).toHaveCount(
		0,
	);
	await section(page, "README.md").getByTestId("changes-section-toggle").click();
	await expect(section(page, "README.md")).toHaveAttribute("data-collapsed", "true");
});

test("a double click opens the per-file tab and a section's Open as tab does the same", async ({
	page,
}) => {
	await seedThreeChanges(page);

	await row(page, "script.ts").dblclick();
	await expect(diffTab(page)).toHaveCount(1);
	await expect(diffTab(page)).toHaveAttribute("data-preview", "false");
	await expect(reviewTab(page)).toHaveCount(0);
	await expect(page.getByTestId("diff-pane")).toBeVisible();

	await row(page, "notes.txt").click();
	await expect(reviewTab(page)).toHaveCount(1);
	await expect(diffTab(page)).toHaveCount(1);

	await section(page, "README.md").getByTestId("changes-section-open-tab").click();
	await expect(diffTab(page)).toHaveCount(2);
	await expect(page.getByTestId("diff-pane").getByTestId("rendered-diff")).toContainText(
		"edited by e2e",
	);
});

test("One file mode walks the scope with Prev / Next and V, sharing progress with the stacked view", async ({
	page,
}) => {
	await seedThreeChanges(page);
	// files are ordered by localeCompare: notes.txt, README.md, script.ts
	await row(page, "notes.txt").click();
	await expect(sections(page)).toHaveCount(3);

	await page.getByTestId("changes-review-layout-single").click();
	await expect(page.getByTestId("changes-review-walk")).toBeVisible();
	await expect(page.getByTestId("changes-review-counter")).toHaveText("1 / 3");
	await expect(sections(page)).toHaveCount(1);
	await expect(section(page, "notes.txt")).toBeVisible();
	await expect(page.getByTestId("changes-review-prev")).toBeDisabled();

	await page.getByTestId("changes-review-next").click();
	await expect(page.getByTestId("changes-review-counter")).toHaveText("2 / 3");
	await expect(section(page, "README.md")).toBeVisible();
	await expect(row(page, "README.md")).toHaveAttribute("data-active", "true");

	await page.keyboard.press("v");
	await expect(page.getByTestId("changes-review-counter")).toHaveText("3 / 3");
	await expect(page.getByTestId("changes-review-viewed-count")).toHaveText("1/3 viewed");
	await expect(row(page, "README.md")).toHaveAttribute("data-viewed", "true");
	await expect(section(page, "script.ts")).toBeVisible();
	await expect(page.getByTestId("changes-review-next")).toBeDisabled();

	await page.getByTestId("changes-review-layout-stacked").click();
	await expect(sections(page)).toHaveCount(3);
	await expect(page.getByTestId("changes-review-viewed-count")).toHaveText("1/3 viewed");
	await expect(section(page, "README.md")).toHaveAttribute("data-viewed", "true");
	await expect(row(page, "script.ts")).toHaveAttribute("data-active", "true");
});

test("the review tab survives a reload and a large file mounts collapsed behind Expand", async ({
	page,
}) => {
	const worktree = await seedThreeChanges(page);
	writeFileSync(
		join(worktree, "big.lock"),
		Array.from({ length: 450 }, (_, index) => `line ${index}`).join("\n"),
	);
	await expect(row(page, "big.lock")).toBeVisible();

	await row(page, "README.md").click();
	await expect(reviewTab(page)).toHaveCount(1);
	const big = section(page, "big.lock");
	await expect(big).toHaveAttribute("data-collapsed", "true");
	await expect(big.getByTestId("changes-section-collapsed")).toContainText("collapsed by default");
	await big.getByTestId("changes-section-expand").click();
	await expect(big).not.toHaveAttribute("data-collapsed", "true");
	await expect(big.getByTestId("diff-view").getByText("line 449").last()).toBeVisible();

	await page.reload();
	await expect(reviewTab(page)).toHaveCount(1);
	await expect(page.getByTestId("changes-review-summary")).toContainText("4 files");
	await expect(sections(page).first()).toBeVisible();
});
