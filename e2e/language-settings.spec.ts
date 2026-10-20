import { expect, test } from "@playwright/test";

/**
 * The language picker is the only place a locale switch is observable, and it is observable only
 * because the choice reloads the client. The assertions below are therefore about the reload: the
 * panel's own copy must come back in the newly chosen language.
 */
test("choosing a language reloads the client and comes back translated", async ({ page }) => {
	await page.goto("/");
	await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");

	await page.getByTestId("open-settings").click();
	await page.getByTestId("settings-nav-language").click();
	const panel = page.getByTestId("settings-language");
	await expect(panel).toContainText("Language");
	await expect(page.getByTestId("language-option-en")).toHaveAttribute("data-active", "true");

	await page.getByTestId("language-option-zh-CN").click();
	await page.waitForLoadState("load");
	await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");

	await page.getByTestId("open-settings").click();
	await page.getByTestId("settings-nav-language").click();
	await expect(panel).toContainText("语言");
	await expect(page.getByTestId("language-option-zh-CN")).toHaveAttribute("data-active", "true");
	await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");

	await page.getByTestId("language-option-en").click();
	await page.waitForLoadState("load");
	await page.getByTestId("open-settings").click();
	await page.getByTestId("settings-nav-language").click();
	await expect(panel).toContainText("Language");
	await expect(page.locator("html")).toHaveAttribute("lang", "en");
});
