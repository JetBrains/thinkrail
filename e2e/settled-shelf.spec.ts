import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { createWorkspaceViaDialog, openFixtureProject, worktreeRows } from "./fixtures/app";

// The Settled shelf: quiet workspaces leave the live list for a collapsed group under the project. Idle
// and merged-PR settling need time or a forge and are pinned by unit tests; this journey covers the
// manual overrides, the topbar mirror, force-reveal, and the dirty-aware bulk Remove end to end.

test("a workspace settles by hand, comes back with Keep active, and the shelf clears in bulk", async ({
	page,
}, testInfo) => {
	await openFixtureProject(page);
	const first = await createWorkspaceViaDialog(page);
	const second = await createWorkspaceViaDialog(page);

	const shelf = page.getByTestId("settled-shelf");
	await expect(page.getByTestId("workspace-sort")).toBeVisible();
	await expect(shelf).toHaveAttribute("data-count", "0");
	await expect(worktreeRows(page)).toHaveCount(2);

	// Hover ✓ on the quiet sibling parks it; the collapsed shelf hides the row and counts it.
	const firstRow = worktreeRows(page).filter({ hasText: first.name });
	await firstRow.hover();
	await firstRow.getByTestId("workspace-settle").click();
	await expect(shelf).toHaveAttribute("data-count", "1");
	await expect(worktreeRows(page)).toHaveCount(1);

	await page.getByTestId("settled-shelf-toggle").click();
	const settledRow = page.locator('[data-testid="workspace-item"][data-settled="override"]');
	await expect(settledRow).toHaveCount(1);
	await expect(settledRow.getByTestId("workspace-settled-reason")).toHaveText("by you");
	await testInfo.attach("shelf-expanded", {
		body: await page
			.getByTestId("project-tree")
			.screenshot({ path: testInfo.outputPath("shelf.png") }),
		contentType: "image/png",
	});

	// The topbar switcher mirrors the partition: live siblings, then a Settled submenu.
	await page.getByTestId("scope-workspace").click();
	await expect(page.getByTestId("scope-workspace-settled")).toHaveCount(0);
	await page.getByTestId("scope-workspace-settled-group").hover();
	await expect(page.getByTestId("scope-workspace-settled-option")).toHaveCount(1);
	await page.keyboard.press("Escape");

	// Opening a settled workspace keeps it settled: force-revealed in the shelf, announced in the caption.
	await settledRow.getByRole("button", { name: first.name, exact: true }).click();
	await expect(page.getByTestId("scope-name")).toHaveText(first.name);
	await expect(page.getByTestId("scope-workspace-settled")).toBeVisible();
	await expect(settledRow).toHaveAttribute("data-active", "true");
	await expect(shelf).toHaveAttribute("data-count", "1");

	// Keep active from the topbar menu returns it to the live list.
	await page.getByTestId("scope-workspace").click();
	await page.getByTestId("scope-workspace-keep-active").click();
	await expect(shelf).toHaveAttribute("data-count", "0");
	await expect(page.getByTestId("scope-workspace-settled")).toHaveCount(0);
	await expect(worktreeRows(page).filter({ hasText: first.name })).toHaveAttribute(
		"data-active",
		"true",
	);

	// Park both, dirty one of them, and clear the shelf: the guard leaves dirty work out until included.
	writeFileSync(join(first.worktreePath, "scratch.txt"), "uncommitted\n");
	for (const workspace of [first, second]) {
		const row = worktreeRows(page).filter({ hasText: workspace.name });
		await row.hover();
		await row.getByTestId("workspace-settle").click();
	}
	await expect(shelf).toHaveAttribute("data-count", "2");
	await shelf.hover();
	await page.getByTestId("settled-shelf-menu").click();
	await page.getByTestId("remove-all-settled").click();
	const dialog = page.getByTestId("remove-settled-dialog");
	await expect(dialog).toBeVisible();
	await expect(dialog.getByTestId("remove-settled-flagged")).toContainText(
		"1 with uncommitted changes",
	);
	await expect(dialog.getByTestId("confirm-remove-settled")).toHaveText("Remove 1");
	await dialog.getByTestId("remove-settled-include").click();
	await expect(dialog.getByTestId("confirm-remove-settled")).toHaveText("Remove 2");
	await testInfo.attach("bulk-remove", {
		body: await page.screenshot({ path: testInfo.outputPath("bulk-remove.png") }),
		contentType: "image/png",
	});
	await dialog.getByTestId("confirm-remove-settled").click();
	await expect(dialog).toBeHidden();
	await expect(worktreeRows(page)).toHaveCount(0);
	await expect(shelf).toHaveAttribute("data-count", "0");
});

test("the settle window is a host setting that survives a reload", async ({ page }) => {
	await openFixtureProject(page);
	await page.getByTestId("open-settings").click();
	await page.getByTestId("settings-nav-workspaces").click();
	await expect(page.getByTestId("settle-idle-3")).toHaveAttribute("data-active", "true");
	await page.getByTestId("settle-idle-14").click();
	await expect(page.getByTestId("settle-idle-14")).toHaveAttribute("data-active", "true");
	await page.reload();
	await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
	await page.getByTestId("open-settings").click();
	await page.getByTestId("settings-nav-workspaces").click();
	await expect(page.getByTestId("settle-idle-14")).toHaveAttribute("data-active", "true");
});
