import { expect, test } from "@playwright/test";
import { createWorkspaceViaDialog, openFixtureProject } from "./fixtures/app";

test("editor tabs are scoped to the active workspace", async ({ page }) => {
	await openFixtureProject(page);
	const tabs = page.getByTestId("editor-tab");
	const workspaces = page.getByTestId("workspace-item");

	// Workspace 1: open README.md in a center tab.
	await createWorkspaceViaDialog(page);
	await expect(workspaces).toHaveCount(1);
	await page.getByTestId("tab-files").click();
	await page.getByTestId("file-node").filter({ hasText: "README.md" }).dblclick();
	await expect(tabs).toHaveCount(1);

	// Workspace 2 is brand new → it must show none of workspace 1's tabs.
	await createWorkspaceViaDialog(page);
	await expect(workspaces).toHaveCount(2);
	await expect(workspaces.nth(1)).toHaveAttribute("data-active", "true");
	await expect(tabs).toHaveCount(0);
	await expect(page.getByTestId("workspace-ready")).toContainText("workspace-2");
	await expect(page.getByTestId("scope-name")).toHaveText("workspace-2");
	await expect(page.getByTestId("scope-branch")).toHaveText("workspace-2");

	// Switching back to workspace 1 restores its tab.
	await workspaces.nth(0).getByRole("button").first().click();
	await expect(workspaces.nth(0)).toHaveAttribute("data-active", "true");
	await expect(page.getByTestId("scope-name")).toHaveText("workspace-1");
	await expect(page.getByTestId("scope-branch")).toHaveText("workspace-1");
	await expect(tabs).toHaveCount(1);
	await expect(tabs.filter({ hasText: "README.md" })).toBeVisible();
});
