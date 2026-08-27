import { expect, test } from "@playwright/test";

test("Review settings: model + effort render and the auto-fix toggle persists across a reload", async ({
	page,
}) => {
	await page.goto("/");
	await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");

	await page.getByTestId("open-settings").click();
	const dialog = page.getByTestId("settings-dialog");
	await expect(dialog).toBeVisible();
	await page.getByTestId("settings-nav-review").click();
	await expect(dialog).toContainText("Reviewer model");

	// The model + effort pickers render (the catalog may be empty without a provider — the controls exist).
	await expect(page.getByTestId("model-selector")).toBeVisible();
	await expect(page.getByTestId("thinking-selector")).toBeVisible();

	// The explicit default-model row exists even with an empty catalog — it is what restores the
	// unset (pi default) state after a reviewer model was chosen.
	await page.getByTestId("model-selector").click();
	await expect(page.getByTestId("model-option-default")).toBeVisible();
	await page.keyboard.press("Escape");

	const toggle = page.getByTestId("review-autofix-toggle");
	await expect(toggle).toHaveAttribute("data-active", "true");
	await toggle.click();
	await expect(toggle).toHaveAttribute("data-active", "false");
	await expect(dialog).toContainText("nothing is auto-sent");

	await page.reload();
	await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
	await page.getByTestId("open-settings").click();
	await page.getByTestId("settings-nav-review").click();
	await expect(toggle).toHaveAttribute("data-active", "false");

	await toggle.click();
	await expect(toggle).toHaveAttribute("data-active", "true");

	await page.keyboard.press("Escape");
	await expect(dialog).toBeHidden();
});
