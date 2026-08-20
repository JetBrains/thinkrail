import { expect, test } from "@playwright/test";

test("privacy section toggles analytics off and the choice persists across a reload", async ({
	page,
}) => {
	await page.goto("/");
	await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");

	await page.getByTestId("open-settings").click();
	const dialog = page.getByTestId("settings-dialog");
	await expect(dialog).toBeVisible();
	await page.getByTestId("settings-nav-privacy").click();
	await expect(dialog).toContainText("Usage analytics");

	const toggle = page.getByTestId("analytics-toggle");
	await expect(toggle).toHaveAttribute("data-active", "true");

	await toggle.click();
	await expect(toggle).toHaveAttribute("data-active", "false");
	await expect(dialog).toContainText("nothing is sent");

	await page.reload();
	await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
	await page.getByTestId("open-settings").click();
	await page.getByTestId("settings-nav-privacy").click();
	await expect(toggle).toHaveAttribute("data-active", "false");

	await toggle.click();
	await expect(toggle).toHaveAttribute("data-active", "true");

	await page.keyboard.press("Escape");
	await expect(dialog).toBeHidden();
});
