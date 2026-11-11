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

test("a toast over Settings can be dismissed without closing Settings, and Escape still closes Settings", async ({
	page,
	context,
}) => {
	await context.grantPermissions(["clipboard-read", "clipboard-write"]);
	await page.goto("/");
	await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
	await page.getByTestId("open-settings").click();
	const dialog = page.getByTestId("settings-dialog");
	await page.getByTestId("settings-nav-language").click();
	await dialog.getByRole("button", { name: "Copy path" }).click();
	const copied = page.getByTestId("toast").filter({ hasText: "Folder path copied" });
	await expect(copied).toBeVisible();

	await copied.locator("button").click();
	await expect(copied).toBeHidden();
	await expect(dialog).toBeVisible();

	await dialog.getByRole("button", { name: "Copy path" }).click();
	await expect(copied).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(dialog).toBeHidden();
});
