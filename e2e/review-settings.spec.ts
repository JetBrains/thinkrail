import { expect, test } from "@playwright/test";
import { closeSettings, openSettingsSection } from "./fixtures/app";

test("Review settings: the model picker follows the default and the auto-fix toggle persists across a reload", async ({
	page,
}) => {
	await page.goto("/");
	await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");

	const dialog = await openSettingsSection(page, "models");
	const reviewGroup = page.getByTestId("models-review-group");
	await expect(reviewGroup.getByRole("heading", { name: "Review" })).toBeVisible();
	const reviewRow = reviewGroup.getByTestId("review-model-row");
	await expect(reviewRow).toContainText("Review model");
	await expect(reviewGroup.getByTestId("review-autofix-row")).toBeVisible();

	// One model + effort picker, as in the chat; the catalog may be empty without a provider.
	const picker = reviewRow.getByTestId("model-selector");
	await expect(picker).toContainText("Default");
	await expect(reviewRow.getByTestId("settings-reset-review-model")).toHaveCount(0);

	// The explicit default row exists even with an empty catalog — it is what restores the
	// unset (pi default) state after a review model was chosen.
	await picker.focus();
	await page.keyboard.press("Enter");
	await expect(page.getByTestId("model-option-default")).toBeVisible();
	await expect(page.getByTestId("model-set-default")).toHaveCount(0);
	await page.keyboard.press("Escape");
	await expect(page.getByTestId("model-option-default")).toHaveCount(0);
	await expect(picker).toBeFocused();
	await expect(dialog).toBeVisible();

	const toggle = page.getByTestId("review-autofix-toggle");
	const reset = page.getByTestId("settings-reset-auto-fix");
	await expect(toggle).toHaveAttribute("data-active", "false");
	await expect(page.getByTestId("review-autofix-row")).toContainText(
		"Send requested changes back to the agent once.",
	);
	await expect(reset).toHaveCount(0);
	await toggle.click();
	await expect(toggle).toHaveAttribute("data-active", "true");
	await expect(page.getByTestId("review-autofix-row")).toContainText("Changed");

	await page.reload();
	await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
	await openSettingsSection(page, "models");
	await expect(toggle).toHaveAttribute("data-active", "true");

	await reset.click();
	await expect(toggle).toHaveAttribute("data-active", "false");
	await expect(reset).toHaveCount(0);

	await closeSettings(page);
});

test("Review settings: the agent-review toggle persists across a reload", async ({ page }) => {
	await page.goto("/");
	await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");

	await openSettingsSection(page, "models");
	await expect(
		page.getByTestId("models-review-group").getByTestId("agent-review-row"),
	).toContainText("Agent-triggered review");

	const toggle = page.getByTestId("agent-review-toggle");
	await expect(toggle).toHaveAttribute("data-active", "false");
	await expect(page.getByTestId("agent-review-row")).toContainText(
		"Allow the agent to review completed work.",
	);
	await toggle.click();
	await expect(toggle).toHaveAttribute("data-active", "true");

	await page.reload();
	await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
	await openSettingsSection(page, "models");
	await expect(toggle).toHaveAttribute("data-active", "true");

	await toggle.click();
	await expect(toggle).toHaveAttribute("data-active", "false");

	await closeSettings(page);
});
