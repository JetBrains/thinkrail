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
	await expect(
		dialog.locator("[data-setting-row]").filter({ has: page.getByTestId("settings-gh-refresh") }),
	).toBeFocused();
	await page.keyboard.press("Escape");
	await expect(page.getByTestId("settings-nav-github")).toBeFocused();
	await expect(dialog).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(dialog).toBeHidden();
});

test("a toast over Settings can be dismissed without closing Settings, and Escape still steps out and closes Settings", async ({
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
	await expect(
		dialog.locator("[data-setting-row]").filter({ has: page.getByTestId("language-folder-path") }),
	).toBeFocused();
	await page.keyboard.press("Escape");
	await expect(page.getByTestId("settings-nav-language")).toBeFocused();
	await page.keyboard.press("Escape");
	await expect(dialog).toBeHidden();
});

test("Settings is as tall as the window allows, no wider than its nav and a reading measure, and its nav is a strip on a phone", async ({
	page,
}) => {
	await page.setViewportSize({ width: 1600, height: 1000 });
	await page.goto("/");
	await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
	await page.getByTestId("open-settings").click();
	const dialog = page.getByTestId("settings-dialog");
	const box = await dialog.boundingBox();
	expect(box?.height).toBe(1000 - 48);
	expect(box?.width).toBeLessThanOrEqual(1028);
	expect(box?.width).toBeGreaterThan(900);
	const nav = await dialog.getByRole("tablist").boundingBox();
	expect(nav?.width).toBeLessThanOrEqual(220);
	await expect(dialog.getByRole("button", { name: "Close", exact: true })).toBeVisible();

	await page.setViewportSize({ width: 390, height: 780 });
	const strip = dialog.getByRole("tablist");
	await expect(strip).toHaveAttribute("aria-orientation", "vertical");
	const first = await strip.getByRole("tab").first().boundingBox();
	const second = await strip.getByRole("tab").nth(1).boundingBox();
	expect(second?.y).toBe(first?.y);
	await page.keyboard.press("Escape");
	await expect(dialog).toBeHidden();
});
