import { expect, test } from "@playwright/test";

test("settings shows the Local GitHub status block and degrades gh gracefully", async ({
	page,
}) => {
	await page.goto("/");
	await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");

	await page.getByTestId("open-settings").click();
	const dialog = page.getByTestId("settings-dialog");
	await expect(dialog).toBeVisible();

	await page.getByTestId("settings-nav-github").click();
	await expect(dialog).toContainText("Local GitHub");

	const status = page.getByTestId("settings-gh-status");
	await expect(status).toHaveAttribute("data-connected", "false");
	await expect(status).toContainText("Not connected");
	await expect(page.getByTestId("settings-gh-refresh")).toBeVisible();

	await page.getByTestId("settings-gh-refresh").click();
	await expect(status).toHaveAttribute("data-connected", "false");

	await page.keyboard.press("Escape");
	await expect(dialog).toBeHidden();
});
