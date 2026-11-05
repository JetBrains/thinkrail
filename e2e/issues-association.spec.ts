import { expect, test } from "@playwright/test";
import { defaultWorkspaceRow, resetApp, skipIssueAssociation } from "./fixtures/app";

test("skipping post-open GitLab association keeps the project and allows entering Default", async ({
	page,
}) => {
	await resetApp(page);
	await page.goto("/");
	await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
	await page.getByTestId("add-project-menu").click();
	await page.getByTestId("menu-open-project").click();
	await expect(page.getByTestId("project-item").first()).toBeVisible();
	const dialog = page.getByTestId("issues-associate-dialog");
	await expect(dialog).toBeVisible();
	await expect(dialog.locator('input[type="password"]')).toHaveCount(1);
	await skipIssueAssociation(page);
	await expect(page.getByTestId("project-item").first()).toBeVisible();
	await page.getByTestId("welcome-action").filter({ hasText: "Work in project folder" }).click();
	await expect(defaultWorkspaceRow(page)).toHaveAttribute("data-active", "true");
	await expect(page.getByTestId("center-tabs")).toBeVisible();
});
