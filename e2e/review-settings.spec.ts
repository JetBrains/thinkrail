import { expect, test } from "@playwright/test";

test("Review settings: model + effort render and the auto-fix toggle persists across a reload", async ({
	page,
}) => {
	await page.goto("/");
	await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");

	await page.getByTestId("open-settings").click();
	const dialog = page.getByTestId("settings-dialog");
	await expect(dialog).toBeVisible();
	await page.getByTestId("settings-nav-models").click();
	const reviewRow = page.getByTestId("review-model-row");
	await expect(reviewRow).toContainText("Review model");

	// The model + effort pickers render (the catalog may be empty without a provider — the controls exist).
	await expect(reviewRow.getByTestId("model-selector")).toBeVisible();
	await expect(reviewRow.getByTestId("thinking-selector")).toBeVisible();

	// The explicit default-model row exists even with an empty catalog — it is what restores the
	// unset (pi default) state after a review model was chosen.
	await reviewRow.getByTestId("model-selector").click();
	await expect(page.getByTestId("model-option-default")).toBeVisible();
	await page.keyboard.press("Escape");

	const toggle = page.getByTestId("review-autofix-toggle");
	await expect(toggle).toHaveAttribute("data-active", "false");
	await expect(page.getByTestId("review-autofix-row")).toContainText(
		"Send requested changes back to the agent once.",
	);
	await toggle.click();
	await expect(toggle).toHaveAttribute("data-active", "true");

	await page.reload();
	await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
	await page.getByTestId("open-settings").click();
	await page.getByTestId("settings-nav-models").click();
	await expect(toggle).toHaveAttribute("data-active", "true");

	await toggle.click();
	await expect(toggle).toHaveAttribute("data-active", "false");

	await page.keyboard.press("Escape");
	await expect(dialog).toBeHidden();
});

test("Review settings: the agent-review toggle persists across a reload", async ({ page }) => {
	await page.goto("/");
	await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");

	await page.getByTestId("open-settings").click();
	const dialog = page.getByTestId("settings-dialog");
	await expect(dialog).toBeVisible();
	await page.getByTestId("settings-nav-models").click();
	await expect(dialog).toContainText("Agent-triggered review");

	const toggle = page.getByTestId("agent-review-toggle");
	await expect(toggle).toHaveAttribute("data-active", "false");
	await expect(page.getByTestId("agent-review-row")).toContainText(
		"Allow the agent to review completed work.",
	);
	await toggle.click();
	await expect(toggle).toHaveAttribute("data-active", "true");

	await page.reload();
	await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
	await page.getByTestId("open-settings").click();
	await page.getByTestId("settings-nav-models").click();
	await expect(toggle).toHaveAttribute("data-active", "true");

	await toggle.click();
	await expect(toggle).toHaveAttribute("data-active", "false");

	await page.keyboard.press("Escape");
	await expect(dialog).toBeHidden();
});
