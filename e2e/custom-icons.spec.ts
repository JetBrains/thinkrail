import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { createWorkspaceViaDialog, openFixtureProject, revealWorkbenchTool } from "./fixtures/app";
import { E2E_DATA_DIR } from "./fixtures/paths";

test("the Changes review tab uses the custom file-diff glyph; Review uses the discuss glyph", async ({
	page,
}) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	const worktree = join(E2E_DATA_DIR, "worktrees", "sample-project", "workspace-1");
	writeFileSync(join(worktree, "README.md"), "# sample-project\n\nedited by e2e\n");
	await revealWorkbenchTool(page, "changes");
	await page.getByTestId("change-item").filter({ hasText: "README.md" }).click();

	const reviewTab = page.locator('[data-testid="editor-tab"][data-kind="changes"]');
	await expect(reviewTab).toHaveCount(1);
	const mask = reviewTab.locator(".custom-icon");
	await expect(mask).toHaveCount(1);
	const maskImage = await mask.evaluate((el) => getComputedStyle(el).maskImage);
	expect(maskImage).toContain("file-diff");
	const box = await mask.boundingBox();
	expect(box?.width ?? 0).toBeGreaterThan(8);

	await expect(page.getByTestId("tab-review").locator("svg")).toHaveCount(1);
});
