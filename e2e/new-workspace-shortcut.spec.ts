import { expect, test } from "@playwright/test";
import { createWorkspaceViaDialog, openFixtureProject } from "./fixtures/app";

test.describe("new workspace keyboard shortcut", () => {
	test("Mod+N opens the Create workspace dialog for the selected project from the Welcome screen, and Escape closes it", async ({
		page,
	}) => {
		await openFixtureProject(page);

		const dialog = page.getByTestId("new-workspace-dialog");
		await expect(page.getByTestId("add-workspace").first()).toHaveAttribute(
			"aria-label",
			/^Create workspace \(.*N.*\)$/,
		);

		await page.getByTestId("welcome-title").click();
		await page.keyboard.press("ControlOrMeta+n");
		await expect(dialog).toBeVisible();
		await expect(dialog.getByRole("heading", { name: "Create workspace" })).toBeVisible();

		await page.keyboard.press("ControlOrMeta+n");
		await expect(dialog).toHaveCount(1);
		await expect(dialog).toBeVisible();

		await page.keyboard.press("Escape");
		await expect(dialog).toBeHidden();
	});

	test("The Mod+Alt+N alias opens the same dialog and Mod+Shift+N does not", async ({ page }) => {
		await openFixtureProject(page);

		const dialog = page.getByTestId("new-workspace-dialog");
		await page.getByTestId("welcome-title").click();

		await page.keyboard.press("ControlOrMeta+Shift+n");
		await expect(dialog).toHaveCount(0);

		await page.keyboard.press("ControlOrMeta+Alt+n");
		await expect(dialog).toBeVisible();
		await expect(dialog.getByRole("heading", { name: "Create workspace" })).toBeVisible();

		await page.keyboard.press("Escape");
		await expect(dialog).toBeHidden();
	});

	test("Mod+N works inside an active workspace", async ({ page }) => {
		await openFixtureProject(page);
		await createWorkspaceViaDialog(page);

		const dialog = page.getByTestId("new-workspace-dialog");
		await page.keyboard.press("Escape");
		await page.keyboard.press("ControlOrMeta+n");
		await expect(dialog).toBeVisible();
		await expect(dialog.getByRole("heading", { name: "Create workspace" })).toBeVisible();

		await page.keyboard.press("Escape");
		await expect(dialog).toBeHidden();
	});
});
